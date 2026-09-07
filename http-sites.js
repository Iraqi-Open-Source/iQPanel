const { send, getSite, log, slugify, now, id, db, siteAgent } = require('./http-shared');
const { allocatePorts } = require('./ports');
const { queueDeploy } = require('./deployments');

async function applySiteConfig(site) {
  const agent = siteAgent(site);
  const web = site.webserver === 'apache'
    ? await agent.invoke('applyApacheConfig', site)
    : await agent.invoke('applyNginxConfig', site);
  let php = null;
  if (site.type === 'php') php = await agent.invoke('applyPhpPool', site);
  const status = web.applied || php?.applied ? 'applied' : 'generated';
  db.run(`UPDATE sites SET config_status=${db.sql(status)}, updated_at=${db.sql(now())} WHERE id=${db.sql(site.id)}`);
  return { web, php, status };
}

async function handleSites(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/sites') {
    send(response, 200, db.rows('SELECT * FROM sites ORDER BY created_at DESC'));
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/sites') {
    const input = await require('./http-shared').body(request);
    const repo = String(input.repo || '').trim();
    if (!/^git@[\w.-]+:[\w./-]+(?:\.git)?$/.test(repo)) throw new Error('A valid GitHub SSH URL is required');
    if (String(input.server || input.webserver || '').toLowerCase() === 'apache') webserver = 'apache';
    const name = String(input.name || repo.split('/').pop().replace(/\.git$/, '')).trim();
    const slug = slugify(name);
    if (getSite(slug)) throw new Error('A site with this name already exists');
    const type = ['php', 'node', 'python', 'static'].includes(input.type) ? input.type : 'php';
    const ports = allocatePorts(db.rows('SELECT port, app_port FROM sites'));
    const created = now();
    const site = { id: id(), name, slug, type, repo_url: repo, port: ports.port, app_port: ports.app_port, webserver: 'nginx', runtime_version: type === 'php' ? '8.3' : null, status: 'online', config_status: 'pending', created_at: created, updated_at: created };
    const key = await siteAgent(site).invoke('createSite', slug);
    db.run(`INSERT INTO sites (id,name,slug,type,repo_url,deploy_key_path,deploy_key_public,port,app_port,webserver,runtime_version,status,config_status,created_at,updated_at) VALUES (${db.sql(site.id)},${db.sql(site.name)},${db.sql(site.slug)},${db.sql(site.type)},${db.sql(site.repo_url)},${db.sql(key.keyPath)},${db.sql(key.publicKey)},${site.port},${site.app_port},'nginx',${db.sql(site.runtime_version)},'online','pending',${db.sql(created)},${db.sql(created)})`);
    const applied = await applySiteConfig(site);
    log('Site created', name, `Deploy key generated for ${slug}`);
    send(response, 201, { ...site, config_status: applied.status, deploy_key_public: key.publicKey });
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
    send(response, 200, { ...site, ...deployConfig(site, host) });
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
