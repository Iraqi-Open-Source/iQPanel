#!/usr/bin/env node
/**
 * iQPanel background worker.
 * Polls the jobs table and executes deploy, rollback, backup, and self-update jobs.
 */
import { readFileSync } from 'node:fs';

const ENV_FILE = process.env.PANEL_ENV_FILE ?? '/etc/panel-agent/env';
try {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
} catch {}

import { mkdirSync, createWriteStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { query, get, run } from './data/db.js';
import { invoke, stream } from './agent-client.js';
import { nextQueuedJob, markJobRunning, recoverStaleRunningJobs, nowIso } from './domain/jobs.js';
import { createStep, appendStepOutput, finishStep, normalizeRecipeCmd } from './domain/deploy-steps.js';

const DATA_ROOT  = process.env.PANEL_DATA_ROOT ?? '/var/lib/iqpanel';
const POLL_MS    = 2_000;

async function runStreamStep(deploymentId, position, name, cmd, logEmit, action, args) {
  const stepId = createStep(deploymentId, { position, name, cmd, status: 'running' });
  logEmit(`[${nowIso()}] ${name}${cmd ? `: ${cmd}` : ''}\n`);
  try {
    const result = await stream(action, args, (t, d) => {
      if (t === 'stdout' || t === 'stderr') {
        const text = String(d ?? '');
        appendStepOutput(stepId, text);
        logEmit(text);
      }
    });
    finishStep(stepId, { status: 'success', exit_code: 0 });
    return result;
  } catch (e) {
    const msg = `${e.message ?? e}\n`;
    finishStep(stepId, { status: 'failed', exit_code: 1, extra: msg });
    logEmit(msg);
    throw e;
  }
}

async function processDeploy(payload, logPath) {
  const { site_id, deployment_id } = payload;
  const site = get('SELECT * FROM sites WHERE id = ?', [site_id]);
  if (!site) throw new Error('Site not found');

  const log = createWriteStream(logPath, { flags: 'a' });
  const emit = (line) => { log.write(line); process.stdout.write(line); };
  const now  = () => new Date().toISOString();

  emit(`[${now()}] Starting deploy for ${site.slug}\n`);

  let isFirstDeploy = false;
  try {
    const commit = await invoke('git.current_commit', { slug: site.slug });
    isFirstDeploy = !commit.sha;
  } catch { isFirstDeploy = true; }

  let pos = 0;
  if (site.repo_url) {
    if (isFirstDeploy) {
      const cloned = await runStreamStep(
        deployment_id, pos++, 'Clone repository',
        `git clone ${site.repo_url}`, emit,
        'git.clone', { slug: site.slug, url: site.repo_url, branch: site.deploy_branch ?? 'main' }
      );
      if (cloned?.already) isFirstDeploy = false;
    } else {
      if (site.type === 'laravel') {
        try {
          await runStreamStep(
            deployment_id, pos++, 'Maintenance on',
            'php artisan down --retry=60', emit,
            'exec.run', { slug: site.slug, cmd: 'php artisan down --retry=60' }
          );
        } catch {}
      }
      await runStreamStep(
        deployment_id, pos++, 'Pull latest code',
        `git pull origin ${site.deploy_branch ?? 'main'}`, emit,
        'git.pull', { slug: site.slug, branch: site.deploy_branch ?? 'main' }
      );
    }
  }

  const commitInfo = await invoke('git.current_commit', { slug: site.slug }).catch(() => ({}));

  const steps = query('SELECT * FROM site_deploy_steps WHERE site_id = ? AND enabled = 1 ORDER BY position', [site_id]);
  for (const step of steps) {
    const cmd = normalizeRecipeCmd(step.cmd);
    if (step.first_only && !isFirstDeploy) {
      createStep(deployment_id, {
        position: pos++, name: cmd, cmd, status: 'skipped',
      });
      emit(`[${now()}] Skip (first-deploy only): ${cmd}\n`);
      continue;
    }
    await runStreamStep(
      deployment_id, pos++, cmd, cmd, emit,
      'exec.run', { slug: site.slug, cmd }
    );
  }

  if (site.type === 'laravel' && !isFirstDeploy) {
    try {
      await runStreamStep(
        deployment_id, pos++, 'Maintenance off',
        'php artisan up', emit,
        'exec.run', { slug: site.slug, cmd: 'php artisan up' }
      );
    } catch {}
  }

  emit(`[${now()}] Deploy complete (${commitInfo.sha ?? 'unknown'})\n`);
  log.end();

  run('UPDATE deployments SET status = ?, commit_sha = ?, commit_msg = ?, finished_at = ? WHERE id = ?',
    ['success', commitInfo.sha ?? null, commitInfo.message ?? null, now(), deployment_id]);
  run('UPDATE sites SET status = ? WHERE id = ?', ['online', site_id]);
}

async function processRollback(payload, logPath) {
  const { site_id, deployment_id, commit_sha } = payload;
  const site = get('SELECT * FROM sites WHERE id = ?', [site_id]);
  if (!site) throw new Error('Site not found');

  const log = createWriteStream(logPath, { flags: 'a' });
  const emit = (line) => { log.write(line); process.stdout.write(line); };

  emit(`[${nowIso()}] Rolling back ${site.slug} to ${commit_sha}\n`);
  let pos = 0;
  await runStreamStep(
    deployment_id, pos++, 'Reset to commit', `git reset --hard ${commit_sha}`, emit,
    'git.reset', { slug: site.slug, sha: commit_sha }
  );

  const steps = query('SELECT * FROM site_deploy_steps WHERE site_id = ? AND enabled = 1 AND first_only = 0 ORDER BY position', [site_id]);
  for (const step of steps) {
    const cmd = normalizeRecipeCmd(step.cmd);
    await runStreamStep(
      deployment_id, pos++, cmd, cmd, emit,
      'exec.run', { slug: site.slug, cmd }
    );
  }

  log.end();
  run('UPDATE deployments SET status = ?, finished_at = ? WHERE id = ?', ['success', nowIso(), deployment_id]);
}

async function processBackup(payload) {
  const { site_id, backup_id } = payload;
  const site = get('SELECT * FROM sites WHERE id = ?', [site_id]);
  if (!site) throw new Error('Site not found');

  const dest = join('/var/backups/panel', `${site.slug}-${Date.now()}.tar.gz`);
  mkdirSync('/var/backups/panel', { recursive: true });

  await stream('exec.run', {
    slug: site.slug,
    cmd:  `tar -czf ${dest} -C /var/www/sites/${site.slug}/app .`,
  }, () => {});

  let size = 0;
  try { size = statSync(dest).size; } catch {}
  run('UPDATE backups SET status = ?, path = ?, size = ? WHERE id = ?', ['done', dest, size, backup_id]);
}

async function tick() {
  const now = nowIso();
  const job = nextQueuedJob(now);
  if (!job) return;

  markJobRunning(job.id, now);

  let payload;
  try { payload = JSON.parse(job.payload); } catch { payload = {}; }

  const logPath = (payload.log_path || payload.deployment_id)
    ? (payload.log_path ?? join(DATA_ROOT, 'deploy-logs', `${payload.deployment_id ?? job.id}.log`))
    : null;
  if (logPath) mkdirSync(join(DATA_ROOT, 'deploy-logs'), { recursive: true });

  if (payload.deployment_id) {
    run(`UPDATE deployments SET status = 'running' WHERE id = ?`, [payload.deployment_id]);
  }

  try {
    if (job.type === 'deploy')   await processDeploy(payload, logPath);
    else if (job.type === 'rollback') await processRollback(payload, logPath);
    else if (job.type === 'backup')   await processBackup(payload);
    run(`UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?`, [nowIso(), job.id]);
  } catch (e) {
    console.error('[worker] job failed', job.id, e.message);
    const attempts = (job.attempts ?? 0) + 1;
    const failed = attempts >= (job.max_attempts ?? 3);
    run(`UPDATE jobs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`,
      [failed ? 'failed' : 'queued', e.message, nowIso(), job.id]);
    if (payload.deployment_id) {
      if (failed) {
        run(`UPDATE deployments SET status = 'failed', finished_at = ? WHERE id = ?`,
          [nowIso(), payload.deployment_id]);
      } else {
        run(`UPDATE deployments SET status = 'queued' WHERE id = ?`, [payload.deployment_id]);
      }
    }
  }
}

let busy = false;
async function loop() {
  if (busy) return;
  busy = true;
  try { await tick(); } catch (e) { console.error('[worker] tick', e); }
  finally { busy = false; }
}

recoverStaleRunningJobs();
console.log('[worker] started, polling every', POLL_MS, 'ms');
setInterval(loop, POLL_MS);
loop();

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
