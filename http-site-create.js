const { send, getSite, log, slugify, now, id, db, siteAgent, body } = require('./http-shared');
const { allocatePorts } = require('./ports');
const { resolveServerId } = require('./servers');
const { ensureWebhookSecret, deployConfig } = require('./deployments');

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

async function handleSiteCreate(request, response, pathname) {
  if (!(request.method === 'POST' && pathname === '/api/sites')) return false;
  const input = await body(request);
  const repo = String(input.repo || '').trim();
  if (!/^git@[\w.-]+:[\w./-]+(?:\.git)?$/.test(repo)) throw new Error('A valid GitHub SSH URL is required');
  const webserver = String(input.server || input.webserver || 'nginx').toLowerCase() === 'apache' ? 'apache' : 'nginx';
  const name = String(input.name || repo.split('/').pop().replace(/\.git$/, '')).trim();
  const slug = slugify(name);
  if (getSite(slug)) throw new Error('A site with this name already exists');
  const type = ['php', 'node', 'python', 'static', 'docker'].includes(input.type) ? input.type : 'php';
  const ports = allocatePorts(db.rows('SELECT port, app_port FROM sites'));
  const created = now();
  const runtime_version = input.runtime_version
    ? String(input.runtime_version)
    : (type === 'php' ? '8.3' : type === 'node' ? '20' : null);
  const server_id = resolveServerId(input.server_id);
  const site = {
    id: id(),
    name,
    slug,
    type,
    repo_url: repo,
    port: ports.port,
    app_port: ports.app_port,
    webserver,
    runtime_version,
    server_id,
    status: 'online',
    config_status: 'pending',
    created_at: created,
    updated_at: created,
  };
  const key = await siteAgent(site).invoke('createSite', slug);
  site.run_as_user = key.run_as_user;
  db.run(`INSERT INTO sites (id,name,slug,type,repo_url,deploy_key_path,deploy_key_public,port,app_port,webserver,runtime_version,server_id,status,config_status,run_as_user,created_at,updated_at) VALUES (${db.sql(site.id)},${db.sql(site.name)},${db.sql(site.slug)},${db.sql(site.type)},${db.sql(site.repo_url)},${db.sql(key.keyPath)},${db.sql(key.publicKey)},${site.port},${site.app_port},${db.sql(webserver)},${db.sql(site.runtime_version)},${db.sql(server_id)},'online','pending',${db.sql(site.run_as_user)},${db.sql(created)},${db.sql(created)})`);
  ensureWebhookSecret(site.id);
  const applied = await applySiteConfig(site);
  log('Site created', name, `Deploy key generated for ${slug}`);
  const createdSite = getSite(slug);
  send(response, 201, {
    ...createdSite,
    config_status: applied.status,
    deploy_key_public: key.publicKey,
    ...deployConfig(createdSite, request.headers.host || 'localhost'),
  });
  return true;
}

module.exports = { handleSiteCreate, applySiteConfig };
