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

const DATA_ROOT  = process.env.PANEL_DATA_ROOT ?? '/var/lib/iqpanel';
const POLL_MS    = 2_000;

async function processDeploy(payload, logPath) {
  const { site_id, deployment_id } = payload;
  const site = get('SELECT * FROM sites WHERE id = ?', [site_id]);
  if (!site) throw new Error('Site not found');

  const log = createWriteStream(logPath, { flags: 'a' });
  const emit = (line) => { log.write(line); process.stdout.write(line); };
  const now  = () => new Date().toISOString();

  emit(`[${now()}] Starting deploy for ${site.slug}\n`);

  // Check if already cloned
  let isFirstDeploy = false;
  try {
    const commit = await invoke('git.current_commit', { slug: site.slug });
    isFirstDeploy = !commit.sha;
  } catch { isFirstDeploy = true; }

  if (isFirstDeploy && site.repo_url) {
    emit(`[${now()}] Cloning ${site.repo_url}\n`);
    await stream('git.clone', { slug: site.slug, url: site.repo_url, branch: site.deploy_branch ?? 'main' }, (t, d) => {
      if (t === 'stdout' || t === 'stderr') emit(d);
    });
  } else if (site.repo_url) {
    emit(`[${now()}] Pulling latest code\n`);
    // artisan down first if site is online
    if (site.type === 'laravel') {
      try { await stream('exec.run', { slug: site.slug, cmd: 'php artisan down --retry=60' }, () => {}); } catch {}
    }
    await stream('git.pull', { slug: site.slug, branch: site.deploy_branch ?? 'main' }, (t, d) => {
      if (t === 'stdout' || t === 'stderr') emit(d);
    });
  }

  // Get commit SHA
  const commitInfo = await invoke('git.current_commit', { slug: site.slug }).catch(() => ({}));

  // Run deploy steps
  const steps = query('SELECT * FROM site_deploy_steps WHERE site_id = ? AND enabled = 1 ORDER BY position', [site_id]);
  for (const step of steps) {
    if (step.first_only && !isFirstDeploy) continue;
    emit(`[${now()}] Running: ${step.cmd}\n`);
    await stream('exec.run', { slug: site.slug, cmd: step.cmd }, (t, d) => {
      if (t === 'stdout' || t === 'stderr') emit(d);
    });
  }

  // artisan up
  if (site.type === 'laravel' && !isFirstDeploy) {
    try { await stream('exec.run', { slug: site.slug, cmd: 'php artisan up' }, () => {}); } catch {}
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
  const emit = (line) => { log.write(line); };
  const now  = () => new Date().toISOString();

  emit(`[${now()}] Rolling back ${site.slug} to ${commit_sha}\n`);
  await stream('git.reset', { slug: site.slug, sha: commit_sha }, (t, d) => { if (t !== 'exit') emit(d); });

  // Rerun all non-first-only steps
  const steps = query('SELECT * FROM site_deploy_steps WHERE site_id = ? AND enabled = 1 AND first_only = 0 ORDER BY position', [site_id]);
  for (const step of steps) {
    emit(`[${now()}] Running: ${step.cmd}\n`);
    await stream('exec.run', { slug: site.slug, cmd: step.cmd }, (t, d) => { if (t !== 'exit') emit(d); });
  }

  log.end();
  run('UPDATE deployments SET status = ?, finished_at = ? WHERE id = ?', ['success', now(), deployment_id]);
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
  const job = get(
    `SELECT * FROM jobs WHERE status = 'queued' AND run_after <= datetime('now') ORDER BY created_at LIMIT 1`
  );
  if (!job) return;

  run(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?`, [job.id]);

  let payload;
  try { payload = JSON.parse(job.payload); } catch { payload = {}; }

  const logPath = payload.log_path ?? payload.deployment_id
    ? join(DATA_ROOT, 'deploy-logs', `${payload.deployment_id ?? job.id}.log`)
    : null;
  if (logPath) mkdirSync(join(DATA_ROOT, 'deploy-logs'), { recursive: true });

  if (payload.deployment_id) {
    run(`UPDATE deployments SET status = 'running' WHERE id = ?`, [payload.deployment_id]);
  }

  try {
    if (job.type === 'deploy')   await processDeploy(payload, logPath);
    else if (job.type === 'rollback') await processRollback(payload, logPath);
    else if (job.type === 'backup')   await processBackup(payload);
    run(`UPDATE jobs SET status = 'done', updated_at = datetime('now') WHERE id = ?`, [job.id]);
  } catch (e) {
    console.error('[worker] job failed', job.id, e.message);
    const failed = job.attempts >= job.max_attempts;
    run(`UPDATE jobs SET status = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?`,
      [failed ? 'failed' : 'queued', e.message, job.id]);
    if (payload.deployment_id) {
      run(`UPDATE deployments SET status = 'failed', finished_at = datetime('now') WHERE id = ?`,
        [payload.deployment_id]);
    }
  }
}

console.log('[worker] started, polling every', POLL_MS, 'ms');
setInterval(tick, POLL_MS);
tick();

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
