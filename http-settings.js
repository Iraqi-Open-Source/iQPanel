const { send, body, log, db, secrets } = require('./http-shared');

function setting(key) {
  return db.rows(`SELECT value FROM settings WHERE key=${db.sql(key)}`)[0]?.value || '';
}

function publicSettings() {
  return {
    telegram_configured: Boolean(setting('telegram_bot_token')),
    ftp_configured: Boolean(setting('ftp_host') && setting('ftp_password')),
    ftp_host: setting('ftp_host'),
    ftp_user: setting('ftp_user'),
    telegram_chat_id: setting('telegram_chat_id'),
    active_server_id: setting('active_server_id') || 'local',
    alert_cooldown_minutes: Number(setting('alert_cooldown_minutes') || 60),
  };
}

function backupCredentials() {
  const telegramCipher = setting('telegram_bot_token');
  const ftpCipher = setting('ftp_password');
  return {
    telegram: {
      bot_token: telegramCipher ? secrets.decrypt(telegramCipher) : '',
      chat_id: setting('telegram_chat_id'),
    },
    ftp: {
      host: setting('ftp_host'),
      user: setting('ftp_user'),
      password: ftpCipher ? secrets.decrypt(ftpCipher) : '',
      remote_dir: setting('ftp_remote_dir') || '/backups',
    },
  };
}

async function handleSettings(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/settings') {
    send(response, 200, publicSettings());
    return true;
  }
  if (request.method === 'PUT' && pathname === '/api/settings') {
    const input = await body(request);
    const writes = [];
    if (input.ftp_host !== undefined) writes.push(['ftp_host', String(input.ftp_host)]);
    if (input.ftp_user !== undefined) writes.push(['ftp_user', String(input.ftp_user)]);
    if (input.ftp_remote_dir !== undefined) writes.push(['ftp_remote_dir', String(input.ftp_remote_dir)]);
    if (input.telegram_chat_id !== undefined) writes.push(['telegram_chat_id', String(input.telegram_chat_id)]);
    if (input.active_server_id !== undefined) writes.push(['active_server_id', String(input.active_server_id)]);
    if (input.alert_cooldown_minutes !== undefined && Number(input.alert_cooldown_minutes) >= 1) writes.push(['alert_cooldown_minutes', String(Math.min(10080, Number(input.alert_cooldown_minutes)))]);
    if (input.ftp_password) writes.push(['ftp_password', secrets.encrypt(String(input.ftp_password))]);
    if (input.telegram_bot_token) writes.push(['telegram_bot_token', secrets.encrypt(String(input.telegram_bot_token))]);
    for (const [key, value] of writes) {
      db.run(`INSERT INTO settings (key, value) VALUES (${db.sql(key)}, ${db.sql(value)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
    }
    log('Settings updated', 'panel');
    send(response, 200, publicSettings());
    return true;
  }
  return false;
}

module.exports = { handleSettings, publicSettings, backupCredentials };
