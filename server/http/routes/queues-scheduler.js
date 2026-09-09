import { randomBytes } from 'node:crypto';
import { query, get, run } from '../../data/db.js';
import { invoke } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';
import { buildQueueWorkerUnit, buildHorizonUnit } from '../../domain/provisioning.js';

function uuid()   { return randomBytes(16).toString('hex'); }
function nowIso() { return new Date().toISOString(); }

export function registerQueuesScheduler(app) {
  // GET /api/sites/:slug/queues
  app.get('/api/sites/:slug/queues', requireAuth, (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const units = query('SELECT * FROM systemd_units WHERE site_id = ?', [site.id]);
    res.json(units);
  });

  // POST /api/sites/:slug/queues  – create queue worker or horizon
  app.post('/api/sites/:slug/queues', requireAuth, rbac('operator'), async (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const { template = 'queue', queue = 'default', tries = 3, timeout = 90 } = req.body ?? {};
    if (!['queue','horizon'].includes(template)) return res.status(400).json({ error: 'template must be queue or horizon' });

    const unitName  = `panel-${site.slug}-${template}.service`;
    const existing  = get('SELECT id FROM systemd_units WHERE unit_name = ?', [unitName]);
    if (existing) return res.status(409).json({ error: 'Unit already exists' });

    const content = template === 'horizon'
      ? buildHorizonUnit({ slug: site.slug, phpVersion: site.php_version, siteUser: site.run_as_user })
      : buildQueueWorkerUnit({ slug: site.slug, phpVersion: site.php_version, siteUser: site.run_as_user, queue, tries, timeout });

    try {
      await invoke('svc.install_unit', { name: unitName, content });
      await invoke('svc.enable',       { unit: unitName });
      await invoke('svc.start',        { unit: unitName });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }

    const id = uuid();
    run('INSERT INTO systemd_units (id,site_id,unit_name,template,config,status,created_at) VALUES (?,?,?,?,?,?,?)',
      [id, site.id, unitName, template, JSON.stringify({ queue, tries, timeout }), 'running', nowIso()]);

    res.status(201).json(get('SELECT * FROM systemd_units WHERE id = ?', [id]));
  });

  // DELETE /api/sites/:slug/queues/:unitId
  app.delete('/api/sites/:slug/queues/:unitId', requireAuth, rbac('operator'), async (req, res) => {
    const unit = get('SELECT * FROM systemd_units WHERE id = ?', [req.params.unitId]);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    try {
      await invoke('svc.remove_unit', { name: unit.unit_name });
    } catch {}

    run('DELETE FROM systemd_units WHERE id = ?', [unit.id]);
    res.json({ ok: true });
  });

  // POST /api/sites/:slug/queues/:unitId/:action  – start/stop/restart
  app.post('/api/sites/:slug/queues/:unitId/:action', requireAuth, rbac('operator'), async (req, res) => {
    const unit = get('SELECT * FROM systemd_units WHERE id = ?', [req.params.unitId]);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });
    const { action } = req.params;
    if (!['start','stop','restart'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

    try {
      await invoke(`svc.${action}`, { unit: unit.unit_name });
      run('UPDATE systemd_units SET status = ? WHERE id = ?',
        [action === 'stop' ? 'stopped' : 'running', unit.id]);
      res.json({ ok: true, action, unit: unit.unit_name });
    } catch (e) {
      res.status(422).json({ error: e.message });
    }
  });

  // GET /api/sites/:slug/scheduler  – get scheduler cron entry
  app.get('/api/sites/:slug/scheduler', requireAuth, (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const job = get('SELECT * FROM cron_jobs WHERE site_id = ? AND command LIKE ? LIMIT 1',
      [site.id, '%artisan schedule:run%']);
    res.json({ configured: Boolean(job), job: job ?? null });
  });

  // POST /api/sites/:slug/scheduler
  app.post('/api/sites/:slug/scheduler', requireAuth, rbac('operator'), async (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const phpBin = `php${site.php_version}`;
    const cmd    = `cd /var/www/sites/${site.slug}/app && ${phpBin} artisan schedule:run >> /dev/null 2>&1`;
    const sched  = '* * * * *';

    const existing = get('SELECT id FROM cron_jobs WHERE site_id = ? AND command LIKE ?',
      [site.id, '%artisan schedule:run%']);
    if (!existing) {
      run('INSERT INTO cron_jobs (id,site_id,run_as_user,schedule,command,enabled,created_at) VALUES (?,?,?,?,?,1,?)',
        [uuid(), site.id, site.run_as_user ?? 'www-data', sched, cmd, nowIso()]);
    }

    // Flush crontab (no-op ref for future use)

    res.json({ ok: true, schedule: sched, cmd });
  });
}
