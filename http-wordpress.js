const { send, body, getSite, log, siteAgent } = require('./http-shared');

async function handleWordpress(request, response, pathname) {
  const match = pathname.match(/^\/api\/sites\/([^/]+)\/wordpress(?:\/([^/]+))?$/);
  if (!match) return false;
  const site = getSite(match[1]);
  if (!site) { send(response, 404, { error: 'Site not found' }); return true; }
  if (request.method === 'GET') {
    try {
      const result = await siteAgent(site).invoke('wordpress', site.slug, match[2] || 'version');
      send(response, 200, { available: true, stdout: result.stdout, stderr: result.stderr });
    } catch (error) {
      send(response, 200, { available: false, error: error.message });
    }
    return true;
  }
  if (request.method === 'POST') {
    const input = await body(request).catch(() => ({}));
    const action = match[2] || input.action;
    if (action === 'install') {
      const result = await siteAgent(site).invoke('wordpressInstall', site.slug, input);
      log('WordPress installed', site.name);
      send(response, 200, { stdout: result.stdout, stderr: result.stderr });
      return true;
    }
    if (action === 'staging') {
      const target = String(input.target_slug || `${site.slug}-staging`);
      const result = await siteAgent(site).invoke('wordpressStaging', site.slug, target);
      log('WordPress staging created', site.name, target);
      send(response, 200, result);
      return true;
    }
    if (action === 'backup') {
      const result = await siteAgent(site).invoke('wordpressBackup', site.slug);
      log('WordPress backup created', site.name, result.path);
      send(response, 200, result);
      return true;
    }
    if (action === 'restore') {
      const result = await siteAgent(site).invoke('wordpressRestore', site.slug, input.path);
      log('WordPress backup restored', site.name, input.path);
      send(response, 200, result);
      return true;
    }
    const result = await siteAgent(site).invoke('wordpress', site.slug, action, input.args || []);
    log('WordPress action', site.name, action);
    send(response, 200, { stdout: result.stdout, stderr: result.stderr });
    return true;
  }
  return false;
}

module.exports = { handleWordpress };
