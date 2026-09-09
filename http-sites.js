const { send, getSite, log, now, db, siteAgent, publicDatabase } = require('./http-shared');
const { applySiteConfig } = require('./http-site-create');
const { queueDeploy } = require('./deployments');

async function handleSites(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/sites') {
    send(response, 200, db.rows('SELECT * FROM sites ORDER BY created_at DESC'));
    return true;
  }

  const logsMatch = pathname.match(/^\/api\/sites\/([^/]+)\/logs(?:\/([^/]+))?(?:\/(stream))?$/);
  if (logsMatch) {
    const site = getSite(logsMatch[1]);
    if (!site) { send(response, 404, { error: 'Site not found' }); return true; }
    if (request.method === 'GET' && !logsMatch[2]) {
      send(response, 200, await siteAgent(site).invoke('discoverLogs', site.slug));
      return true;
    }
    if (request.method === 'GET' && logsMatch[2] && logsMatch[3] === 'stream') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      let previous = '';
      const push = async () => {
        const text = await siteAgent(site).invoke('readLog', site.slug, logsMatch[2], 200);
        if (text !== previous) {
          const chunk = text.startsWith(previous) ? text.slice(previous.length) : text;
          previous = text;
          response.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        }
      };
      await push();
      const timer = setInterval(() => { push().catch(() => {}); }, 1000);
      request.on('close', () => clearInterval(timer));
      return true;
    }
    if (request.method === 'GET' && logsMatch[2]) {
      send(response, 200, { name: logsMatch[2], text: await siteAgent(site).invoke('readLog', site.slug, logsMatch[2], 200) });
      return true;
    }
  }

  const siteMatch = pathname.match(/^\/api\/sites\/([^/]+)(?:\/(deploy|backup|config|install|ssl|firewall))?$/);
  if (!siteMatch) return false;
  const site = getSite(siteMatch[1]);
  if (!site) { send(response, 404, { error: 'Site not found' }); return true; }
  if (request.method === 'GET' && !siteMatch[2]) {
    const { deployConfig } = require('./deployments');
    const host = request.headers.host || 'localhost';
    let paths = null;
    try {
      paths = await siteAgent(site).invoke('sitePaths', { slug: site.slug, type: site.type, webserver: site.webserver, runtime_version: site.runtime_version });
    } catch {
      paths = null;
    }
    const databases = db.rows(`SELECT * FROM databases WHERE site_id=${db.sql(site.id)}`).map(publicDatabase);
    send(response, 200, { ...site, ...deployConfig(site, host), databases, paths });
    return true;
  }
  if (request.method === 'PATCH' && !siteMatch[2]) {
    const input = await require('./http-shared').body(request);
    const name = input.name ? String(input.name).trim() : site.name;
    const domain = input.domain === undefined ? site.domain : String(input.domain).trim() || null;
    if (domain && !/^[A-Za-z0-9.-]+$/.test(domain)) throw new Error('Invalid domain');
    const nextPort = input.port === undefined ? site.port : Number(input.port);
    if (!name || !Number.isInteger(nextPort) || nextPort < 1 || nextPort > 65535) throw new Error('Invalid site update');
    db.run(`UPDATE sites SET name=${db.sql(name)},domain=${db.sql(domain)},port=${nextPort},updated_at=${db.sql(now())} WHERE id=${db.sql(site.id)}`);
    const updated = getSite(site.slug);
    const applied = await applySiteConfig(updated);
    log('Site updated', name);
    send(response, 200, { ...updated, config_status: applied.status });
    return true;
  }
  if (request.method === 'DELETE' && !siteMatch[2]) {
    await siteAgent(site).invoke('removeSite', site.slug, {
      runtime_version: site.runtime_version,
      run_as_user: site.run_as_user,
      remove_user: db.rows(`SELECT id FROM sites WHERE run_as_user=${db.sql(site.run_as_user)} AND id!=${db.sql(site.id)}`).length === 0,
    });
    db.run(`DELETE FROM sites WHERE id=${db.sql(site.id)}`);
    log('Site deleted', site.name);
    send(response, 204, {});
    return true;
  }
  if (request.method === 'POST' && siteMatch[2] === 'deploy') {
    const queued = queueDeploy(site, { triggered_by: 'admin' });
    log('Deployment queued', site.name, queued.deduplicated ? 'deduplicated' : 'Git SSH deploy');
    send(response, queued.deduplicated ? 200 : 202, {
      status: queued.deduplicated ? 'deduplicated' : 'queued',
      job_id: queued.job?.id || null,
      deployment_id: queued.deployment_id,
    });
    return true;
  }
  if (request.method === 'POST' && siteMatch[2] === 'backup') {
    const { publicDatabase } = require('./http-shared');
    const databases = db.rows(`SELECT * FROM databases WHERE site_id=${db.sql(site.id)}`).map(publicDatabase);
    const job = queue.enqueue('backup', { site, databases, retention: { keepCount: site.backup_keep_count || 5, keepDays: site.backup_keep_days || 14 }, server_id: site.server_id || 'local' });
    log('Backup queued', site.name, job.id);
    send(response, 202, { status: 'queued', job_id: job.id });
    return true;
  }
  if (request.method === 'POST' && siteMatch[2] === 'install') {
    const job = queue.enqueue('install', { site, server_id: site.server_id || 'local' });
    log('Install queued', site.name, job.id);
    send(response, 202, { status: 'queued', job_id: job.id });
    return true;
  }
  if (request.method === 'POST' && siteMatch[2] === 'config') {
    const applied = await applySiteConfig(site);
    log('Configuration applied', site.name, applied.status);
    send(response, 200, applied);
    return true;
  }
  return false;
}

module.exports = { handleSites };
