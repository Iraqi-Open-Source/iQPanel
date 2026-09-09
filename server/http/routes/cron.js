import { randomBytes } from 'node:crypto';
import { query, get, run } from '../../data/db.js';
import { invoke } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';

function uuid()   { return randomBytes(16).toString('hex'); }
function nowIso() { return new Date().toISOString(); }

// Flush panel cron jobs to crontab via agent
async function flushCrontab() {
  const jobs = query('SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY created_at');
  const byUser = {};
  for (const job of jobs) {
    const u = job.run_as_user ?? 'root';
    byUser[u] = byUser[u] ?? [];
    byUser[u].push(`${job.schedule} ${job.command} # iqpanel:${job.id}`);
  }
  for (const [user, lines] of Object.entries(byUser)) {
    await invoke('cron.write', { user, lines });
  }
}

export function registerCron(app) {
  app.get('/api/cron', requireAuth, (req, res) => {
    const siteId = req.query.site_id;
    const jobs = siteId
      ? query('SELECT * FROM cron_jobs WHERE site_id = ? ORDER BY created_at', [siteId])
      : query('SELECT * FROM cron_jobs ORDER BY created_at');
    res.json(jobs);
  });

  app.get('/api/sites/:slug/cron', requireAuth, (req, res) => {
    const site = get('SELECT id FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json(query('SELECT * FROM cron_jobs WHERE site_id = ? ORDER BY created_at', [site.id]));
  });

  app.post('/api/cron', requireAuth, rbac('operator'), async (req, res) => {
    const { site_slug, schedule, command, run_as_user } = req.body ?? {};
    if (!schedule || !command) return res.status(400).json({ error: 'schedule and command required' });

    let siteId = null, siteUser = 'root';
    if (site_slug) {
      const site = get('SELECT * FROM sites WHERE slug = ?', [site_slug]);
      if (!site) return res.status(404).json({ error: 'Site not found' });
      siteId   = site.id;
      siteUser = site.run_as_user ?? 'www-data';
    }

    const id  = uuid();
    run('INSERT INTO cron_jobs (id,site_id,run_as_user,schedule,command,enabled,created_at) VALUES (?,?,?,?,?,1,?)',
      [id, siteId, run_as_user ?? siteUser, schedule, command, nowIso()]);

    try { await flushCrontab(); } catch {}
    res.status(201).json(get('SELECT * FROM cron_jobs WHERE id = ?', [id]));
  });

  app.patch('/api/cron/:id', requireAuth, rbac('operator'), async (req, res) => {
    const job = get('SELECT * FROM cron_jobs WHERE id = ?', [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Not found' });
    const { schedule, command, enabled } = req.body ?? {};
    if (schedule !== undefined) run('UPDATE cron_jobs SET schedule = ? WHERE id = ?', [schedule, job.id]);
    if (command  !== undefined) run('UPDATE cron_jobs SET command = ? WHERE id = ?',  [command,  job.id]);
    if (enabled  !== undefined) run('UPDATE cron_jobs SET enabled = ? WHERE id = ?',  [enabled ? 1 : 0, job.id]);
    try { await flushCrontab(); } catch {}
    res.json(get('SELECT * FROM cron_jobs WHERE id = ?', [job.id]));
  });

  app.delete('/api/cron/:id', requireAuth, rbac('operator'), async (req, res) => {
    const job = get('SELECT * FROM cron_jobs WHERE id = ?', [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Not found' });
    run('DELETE FROM cron_jobs WHERE id = ?', [job.id]);
    try { await flushCrontab(); } catch {}
    res.json({ ok: true });
  });
}
