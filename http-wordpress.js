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
    const result = await siteAgent(site).invoke('wordpress', site.slug, action, input.args || []);
    log('WordPress action', site.name, action);
    send(response, 200, { stdout: result.stdout, stderr: result.stderr });
    return true;
  }
  return false;
}

module.exports = { handleWordpress };
