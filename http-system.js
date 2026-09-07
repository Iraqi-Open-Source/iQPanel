const { send, body, log, db, secrets, agentClient, queue } = require('./http-shared');
const { needsUserMigration } = require('./site-user');

const FEATURE_CATALOG = {
  file_manager: { status: 'available', api: '/api/sites/:slug/files' },
  wordpress: { status: 'available', api: '/api/sites/:slug/wordpress' },
  alerts: { status: 'available', api: '/api/alerts' },
  two_factor: { status: 'available', api: '/api/account/2fa/begin' },
  os_users: { status: 'available', api: '/api/system/migrate-site-users' },
  openlitespeed: { status: 'available', api: '/api/system/openlitespeed' },
  cloudflare: { status: 'configurable', api: '/api/system/cloudflare/dns' },
  mail_server: { status: 'available', api: '/api/system/mail' },
  fail2ban: { status: 'available', api: '/api/system/fail2ban' },
  swap_and_disk: { status: 'available', api: '/api/system/swap' },
  ssh_keys: { status: 'available', api: '/api/system/ssh-keys' },
  stack_presets: { status: 'available', api: 'installer --stack' },
  phpmyadmin: { status: 'available', api: '/api/system/phpmyadmin' },
  disk_extension: { status: 'available', api: '/api/system/disk/extend' },
  service_installer: { status: 'available', api: '/api/system/packages/install' },
  host_services: { status: 'available', api: '/api/system/services' },
  php_installer: { status: 'available', api: '/api/system/php/install' },
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
    send(response, 200, { telegram_configured: Boolean(setting('telegram_bot_token')), discord_configured: Boolean(setting('discord_webhook')), cooldown_minutes: Number(setting('alert_cooldown_minutes') || 60), thresholds: { cpu: Number(setting('alert_cpu_threshold') || 90), memory: Number(setting('alert_memory_threshold') || 90), disk: Number(setting('alert_disk_threshold') || 90) } });
    return true;
  }
  if (request.method === 'PUT' && pathname === '/api/alerts') {
    const input = await body(request);
    const values = [['alert_cpu_threshold', input.cpu], ['alert_memory_threshold', input.memory], ['alert_disk_threshold', input.disk]];
    for (const [key, value] of values) if (value !== undefined && Number(value) >= 1 && Number(value) <= 100) db.run(`INSERT INTO settings(key,value) VALUES (${db.sql(key)},${db.sql(Number(value))}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
    if (input.cooldown_minutes !== undefined && Number(input.cooldown_minutes) >= 1) db.run(`INSERT INTO settings(key,value) VALUES ('alert_cooldown_minutes',${db.sql(Math.min(10080, Number(input.cooldown_minutes)))}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
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
  if (request.method === 'POST' && pathname === '/api/system/update') {
    const existing = db.rows(`SELECT id FROM jobs WHERE type='panelUpdate' AND status IN ('queued','running') ORDER BY created_at ASC LIMIT 1`)[0];
    const job = existing || queue.enqueue('panelUpdate', { server_id: 'local' }, { maxAttempts: 1 });
    if (!existing) log('Panel update queued', 'panel', 'Iraqi-Open-Source/iQPanel@main');
    send(response, 202, { status: 'queued', job_id: job.id, already_queued: Boolean(existing) });
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/system/services') {
    const { publicSettings } = require('./http-settings');
    const packages = require('./packages');
    const result = await agentClient.forServer(publicSettings().active_server_id || 'local').invoke('listSystemdUnits');
    send(response, 200, { services: (result.services || []).filter((item) => packages.UNIT_NAME_RE.test(item.unit)) });
    return true;
  }
  const serviceMatch = pathname.match(/^\/api\/system\/services\/([^/]+)\/(start|stop|restart|enable|disable)$/);
  if (request.method === 'POST' && serviceMatch) {
    const { publicSettings } = require('./http-settings');
    const packages = require('./packages');
    let unit;
    try {
      unit = packages.assertUnitName(decodeURIComponent(serviceMatch[1]));
    } catch (error) {
      send(response, 400, { error: error.message });
      return true;
    }
    const result = await agentClient.forServer(publicSettings().active_server_id || 'local').invoke('controlSystemUnit', unit, serviceMatch[2]);
    log('System service updated', unit, serviceMatch[2]);
    send(response, 200, result);
    return true;
  }
  return false;
}

module.exports = { handleSystem, FEATURE_CATALOG };
