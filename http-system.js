const { send, body, log, db, secrets, agentClient, queue } = require('./http-shared');
const { needsUserMigration } = require('./site-user');

const FEATURE_CATALOG = {
  file_manager: { status: 'available', api: '/api/sites/:slug/files' },
  wordpress: { status: 'available', api: '/api/sites/:slug/wordpress' },
  alerts: { status: 'configurable', api: '/api/settings' },
  two_factor: { status: 'available', api: '/api/account/2fa/begin' },
  os_users: { status: 'available', api: '/api/system/migrate-site-users' },
  openlitespeed: { status: 'planned', api: null },
  cloudflare: { status: 'planned', api: null },
  mail_server: { status: 'planned', api: null },
  fail2ban: { status: 'planned', api: null },
  swap_and_disk: { status: 'planned', api: null },
  ssh_keys: { status: 'planned', api: null },
  service_installer: { status: 'planned', api: null },
};

function setting(key) { return db.rows(`SELECT value FROM settings WHERE key=${db.sql(key)}`)[0]?.value || ''; }

async function handleSystem(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/system/features') {
    send(response, 200, FEATURE_CATALOG);
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/system/capabilities') {
    const result = await agentClient.invoke('systemCapabilities');
    send(response, 200, result);
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/alerts') {
    send(response, 200, { telegram_configured: Boolean(setting('telegram_bot_token')), discord_configured: Boolean(setting('discord_webhook')), thresholds: { cpu: Number(setting('alert_cpu_threshold') || 90), memory: Number(setting('alert_memory_threshold') || 90), disk: Number(setting('alert_disk_threshold') || 90) } });
    return true;
  }
  if (request.method === 'PUT' && pathname === '/api/alerts') {
    const input = await body(request);
    const values = [['alert_cpu_threshold', input.cpu], ['alert_memory_threshold', input.memory], ['alert_disk_threshold', input.disk]];
    for (const [key, value] of values) if (value !== undefined && Number(value) >= 1 && Number(value) <= 100) db.run(`INSERT INTO settings(key,value) VALUES (${db.sql(key)},${db.sql(Number(value))}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
    if (input.discord_webhook) db.run(`INSERT INTO settings(key,value) VALUES ('discord_webhook',${db.sql(secrets.encrypt(input.discord_webhook))}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
    log('Alert settings updated', 'panel');
    send(response, 200, { ok: true });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/system/migrate-site-users') {
    const pending = db.rows('SELECT * FROM sites ORDER BY created_at ASC').filter(needsUserMigration);
    const job = queue.enqueue('migrateSiteUsers', {
      site_ids: pending.map((site) => site.id),
      server_id: 'local',
    });
    log('Site user migration queued', 'panel', `${pending.length} sites`);
    send(response, 202, { status: 'queued', job_id: job.id, pending: pending.length });
    return true;
  }
  return false;
}

module.exports = { handleSystem, FEATURE_CATALOG };
