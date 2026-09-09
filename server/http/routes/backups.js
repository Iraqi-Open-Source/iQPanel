import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { query, get, run } from '../../data/db.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';

function uuid()   { return randomBytes(16).toString('hex'); }
function nowIso() { return new Date().toISOString(); }

export function registerBackups(app) {
  app.get('/api/sites/:slug/backups', requireAuth, (req, res) => {
    const site = get('SELECT id FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json(query('SELECT * FROM backups WHERE site_id = ? ORDER BY created_at DESC', [site.id]));
  });

  app.post('/api/sites/:slug/backups', requireAuth, rbac('operator'), (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const id = uuid();
    run('INSERT INTO backups (id,site_id,status,created_at) VALUES (?,?,?,?)',
      [id, site.id, 'queued', nowIso()]);
    run('INSERT INTO jobs (id,type,payload,status,attempts,max_attempts,last_error,run_after,created_at,updated_at) VALUES (?,?,?,?,0,3,?,?,?,?)',
      [uuid(), 'backup', JSON.stringify({ site_id: site.id, backup_id: id }), 'queued', '', nowIso(), nowIso(), nowIso()]);

    res.status(202).json({ backup_id: id });
  });

  app.delete('/api/backups/:id', requireAuth, rbac('admin'), (req, res) => {
    const backup = get('SELECT * FROM backups WHERE id = ?', [req.params.id]);
    if (!backup) return res.status(404).json({ error: 'Backup not found' });
    if (backup.path) {
      try { unlinkSync(backup.path); } catch {}
    }
    run('DELETE FROM backups WHERE id = ?', [backup.id]);
    res.json({ ok: true });
  });
}
