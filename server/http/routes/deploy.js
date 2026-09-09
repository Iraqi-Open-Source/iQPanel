import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, createWriteStream, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { query, get, run, transaction } from '../../data/db.js';
import { stream } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';
import { auditLog } from '../../domain/audit.js';
import { attachStepSummaries, stepsForDeployment } from '../../domain/deploy-steps.js';

function uuid()   { return randomBytes(16).toString('hex'); }
function nowIso() { return new Date().toISOString(); }

const LOG_DIR = process.env.PANEL_LOG_DIR ?? '/var/log/panel';
const DATA_ROOT = process.env.PANEL_DATA_ROOT ?? '/var/lib/iqpanel';

export function registerDeploy(app) {
  // GET /api/sites/:slug/deployments
  app.get('/api/sites/:slug/deployments', requireAuth, (req, res) => {
    const site = get('SELECT id FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const deploys = query('SELECT * FROM deployments WHERE site_id = ? ORDER BY created_at DESC LIMIT 50', [site.id]);
    res.json(attachStepSummaries(deploys));
  });

  // POST /api/sites/:slug/deploy  – trigger deploy
  app.post('/api/sites/:slug/deploy', requireAuth, rbac('operator'), async (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    // Dedup: don't start if already running
    const active = get(
      `SELECT id FROM jobs WHERE type = 'deploy' AND status IN ('queued','running')
       AND json_extract(payload,'$.site_id') = ?`, [site.id]
    );
    if (active) return res.status(409).json({ error: 'Deploy already in progress' });

    const deployId = uuid();
    const logPath  = join(DATA_ROOT, 'deploy-logs', `${deployId}.log`);
    mkdirSync(join(DATA_ROOT, 'deploy-logs'), { recursive: true });

    run('INSERT INTO deployments (id,site_id,status,log_path,triggered_by,created_at) VALUES (?,?,?,?,?,?)',
      [deployId, site.id, 'queued', logPath, req.user.email, nowIso()]);

    run('INSERT INTO jobs (id,type,payload,status,attempts,max_attempts,last_error,run_after,created_at,updated_at) VALUES (?,?,?,?,0,3,?,?,?,?)',
      [uuid(), 'deploy', JSON.stringify({ site_id: site.id, deployment_id: deployId }), 'queued', '', nowIso(), nowIso(), nowIso()]);

    auditLog(req, 'site.deploy', site.slug);
    res.status(202).json({ deployment_id: deployId });
  });

  // GET /api/deployments/:id/log (SSE stream of live log)
  app.get('/api/deployments/:id/log', requireAuth, (req, res) => {
    const deploy = get('SELECT * FROM deployments WHERE id = ?', [req.params.id]);
    if (!deploy) return res.status(404).json({ error: 'Deployment not found' });

    const sse = res.sse();
    // If finished, read log from disk
    if (deploy.status === 'success' || deploy.status === 'failed') {
      try {
        const content = readFileSync(deploy.log_path, 'utf8');
        sse.send('log', { line: content });
      } catch {}
      sse.send('done', { status: deploy.status });
      sse.close();
      return;
    }
    // Live: poll log file every 500ms
    let pos = 0;
    const interval = setInterval(() => {
      const current = get('SELECT * FROM deployments WHERE id = ?', [deploy.id]);
      if (!current) { clearInterval(interval); sse.close(); return; }
      try {
        const fd  = openSync(current.log_path, 'r');
        const buf = Buffer.alloc(65536);
        const n   = readSync(fd, buf, 0, buf.length, pos);
        closeSync(fd);
        if (n > 0) { pos += n; sse.send('log', { line: buf.slice(0, n).toString() }); }
      } catch {}
      if (current.status === 'success' || current.status === 'failed') {
        clearInterval(interval);
        sse.send('done', { status: current.status });
        sse.close();
      }
    }, 500);
    res.on('close', () => clearInterval(interval));
  });

  // GET /api/deployments/:id/steps  – per-command output
  app.get('/api/deployments/:id/steps', requireAuth, (req, res) => {
    const deploy = get('SELECT * FROM deployments WHERE id = ?', [req.params.id]);
    if (!deploy) return res.status(404).json({ error: 'Deployment not found' });
    res.json({
      id: deploy.id,
      status: deploy.status,
      commit_sha: deploy.commit_sha,
      commit_msg: deploy.commit_msg,
      steps: stepsForDeployment(deploy.id, { includeOutput: true }),
    });
  });

  // POST /api/deployments/:id/rollback
  app.post('/api/deployments/:id/rollback', requireAuth, rbac('operator', { reauth: true }), async (req, res) => {
    const deploy = get('SELECT * FROM deployments WHERE id = ?', [req.params.id]);
    if (!deploy) return res.status(404).json({ error: 'Deployment not found' });
    if (!deploy.commit_sha) return res.status(400).json({ error: 'No commit SHA recorded' });

    const site = get('SELECT * FROM sites WHERE id = ?', [deploy.site_id]);
    const rollbackId = uuid();

    run('INSERT INTO deployments (id,site_id,commit_sha,status,triggered_by,created_at) VALUES (?,?,?,?,?,?)',
      [rollbackId, site.id, deploy.commit_sha, 'queued', `rollback by ${req.user.email}`, nowIso()]);
    run('INSERT INTO jobs (id,type,payload,status,attempts,max_attempts,last_error,run_after,created_at,updated_at) VALUES (?,?,?,?,0,3,?,?,?,?)',
      [uuid(), 'rollback', JSON.stringify({ site_id: site.id, deployment_id: rollbackId, commit_sha: deploy.commit_sha }), 'queued', '', nowIso(), nowIso(), nowIso()]);

    auditLog(req, 'site.rollback', site.slug, { sha: deploy.commit_sha });
    res.status(202).json({ deployment_id: rollbackId });
  });
}

// Webhook registration is in webhooks.js
