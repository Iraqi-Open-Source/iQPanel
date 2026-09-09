import { query, get, run } from '../../data/db.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';

export function registerSettings(app) {
  app.get('/api/settings', requireAuth, rbac('admin'), (req, res) => {
    const rows = query('SELECT key, value FROM settings');
    const obj  = {};
    for (const r of rows) obj[r.key] = r.value;
    res.json(obj);
  });

  app.put('/api/settings', requireAuth, rbac('admin'), (req, res) => {
    const updates = req.body ?? {};
    const ALLOWED_KEYS = new Set([
      'alert_cpu_pct', 'alert_mem_pct', 'alert_disk_pct',
      'discord_webhook', 'telegram_bot_token', 'telegram_chat_id',
      'panel_name', 'backup_keep_days',
    ]);
    for (const [key, value] of Object.entries(updates)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value)]);
    }
    res.json({ ok: true });
  });

  app.get('/api/settings/:key', requireAuth, rbac('admin'), (req, res) => {
    const row = get('SELECT value FROM settings WHERE key = ?', [req.params.key]);
    res.json({ key: req.params.key, value: row?.value ?? null });
  });
}
