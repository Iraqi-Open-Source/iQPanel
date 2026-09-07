const { send, getSite, log, now, db, siteAgent, body } = require('./http-shared');
const queue = require('./queue');
const { backupCredentials } = require('./http-settings');

async function handleSiteExtras(request, response, pathname) {
  const match = pathname.match(/^\/api\/sites\/([^/]+)\/(ssl|firewall|backup)$/);
  if (!match) return false;
  const site = getSite(match[1]);
  if (!site) {
    send(response, 404, { error: 'Site not found' });
    return true;
  }
  const agent = siteAgent(site);
  if (request.method === 'POST' && match[2] === 'ssl') {
    if (!site.domain) throw new Error('A domain is required before requesting a certificate');
    const result = await agent.invoke('requestCertificate', site);
    db.run(`UPDATE sites SET ssl_status=${db.sql(result.applied ? 'issued' : 'pending')}, updated_at=${db.sql(now())} WHERE id=${db.sql(site.id)}`);
    log('Certificate requested', site.name, site.domain);
    send(response, 200, result);
    return true;
  }
  if (request.method === 'POST' && match[2] === 'firewall') {
    const input = await body(request);
    const action = input.action === 'close' ? 'close' : 'open';
    const result = action === 'close'
      ? await agent.invoke('closeSitePort', site.port)
      : await agent.invoke('openSitePort', site.port);
    db.run(`UPDATE sites SET public_access=${action === 'open' ? 1 : 0}, updated_at=${db.sql(now())} WHERE id=${db.sql(site.id)}`);
    log('Firewall updated', site.name, action);
    send(response, 200, result);
    return true;
  }
  if (request.method === 'POST' && match[2] === 'backup') {
    const { publicDatabase } = require('./http-shared');
    const input = await body(request).catch(() => ({}));
    const destination = ['local', 'ftp', 'telegram'].includes(input.destination) ? input.destination : 'local';
    const databases = db.rows(`SELECT * FROM databases WHERE site_id=${db.sql(site.id)}`).map(publicDatabase);
    const job = queue.enqueue('backup', {
      site,
      databases,
      retention: { keepCount: site.backup_keep_count || 5, keepDays: site.backup_keep_days || 14 },
      destination,
      credentials: backupCredentials(),
      server_id: site.server_id || 'local',
    });
    log('Backup queued', site.name, job.id);
    send(response, 202, { status: 'queued', job_id: job.id });
    return true;
  }
  return false;
}

module.exports = { handleSiteExtras };
