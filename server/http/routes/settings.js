import { query, get, run } from '../../data/db.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';
import { encryptField } from '../../domain/secrets.js';
import { isIpAddress } from '../../domain/cloudflare.js';

const UPSERT = 'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value';

const ALLOWED_KEYS = new Set([
  'alert_cpu_pct', 'alert_mem_pct', 'alert_disk_pct',
  'discord_webhook', 'telegram_bot_token', 'telegram_chat_id',
  'panel_name', 'backup_keep_days',
  'cloudflare_api_token', 'cloudflare_auto_dns', 'server_public_ip',
]);

function publicSettings(rows) {
  const obj = {};
  for (const row of rows) {
    if (row.key === 'cloudflare_api_token') {
      obj.cloudflare_token_set = row.value ? '1' : '0';
      continue;
    }
    obj[row.key] = row.value;
  }
  if (!('cloudflare_token_set' in obj)) obj.cloudflare_token_set = '0';
  return obj;
}

export function registerSettings(app) {
  app.get('/api/settings', requireAuth, rbac('admin'), (req, res) => {
    res.json(publicSettings(query('SELECT key, value FROM settings')));
  });

  app.put('/api/settings', requireAuth, rbac('admin'), (req, res) => {
    const updates = req.body ?? {};
    if (Object.prototype.hasOwnProperty.call(updates, 'server_public_ip')) {
      const ip = String(updates.server_public_ip ?? '').trim();
      if (ip && !isIpAddress(ip)) return res.status(400).json({ error: 'Invalid server IP address' });
    }

    for (const [key, value] of Object.entries(updates)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      if (key === 'cloudflare_api_token') {
        if (value == null) {
          run('DELETE FROM settings WHERE key = ?', [key]);
          continue;
        }
        const token = String(value).trim();
        if (!token) continue;
        run(UPSERT, [key, encryptField(token)]);
        continue;
      }
      if (key === 'cloudflare_auto_dns') {
        const on = value === true || value === 1 || value === '1' || value === 'true';
        run(UPSERT, [key, on ? '1' : '0']);
        continue;
      }
      if (key === 'server_public_ip') {
        run(UPSERT, [key, String(value ?? '').trim()]);
        continue;
      }
      run(UPSERT, [key, String(value)]);
    }
    res.json({ ok: true });
  });

  app.get('/api/settings/:key', requireAuth, rbac('admin'), (req, res) => {
    if (req.params.key === 'cloudflare_api_token') {
      const row = get('SELECT value FROM settings WHERE key = ?', [req.params.key]);
      return res.json({ key: req.params.key, value: null, set: Boolean(row?.value) });
    }
    const row = get('SELECT value FROM settings WHERE key = ?', [req.params.key]);
    res.json({ key: req.params.key, value: row?.value ?? null });
  });
}
