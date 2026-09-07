const { send, body, getSite, log, siteAgent } = require('./http-shared');

function relativePath(request) {
  return new URL(request.url, 'http://localhost').searchParams.get('path') || '.';
}

async function handleFiles(request, response, pathname) {
  const match = pathname.match(/^\/api\/sites\/([^/]+)\/files$/);
  const fileMatch = pathname.match(/^\/api\/sites\/([^/]+)\/files\/content$/);
  if (!match && !fileMatch) return false;
  const site = getSite((match || fileMatch)[1]);
  if (!site) { send(response, 404, { error: 'Site not found' }); return true; }
  if (fileMatch && request.method === 'GET') {
    const result = await siteAgent(site).invoke('readSiteFile', site.slug, relativePath(request));
    send(response, 200, result);
    return true;
  }
  if (request.method === 'GET') {
    const path = relativePath(request);
    const entries = await siteAgent(site).invoke('listFiles', site.slug, path);
    send(response, 200, { path, entries });
    return true;
  }
  if (request.method === 'POST') {
    const input = await body(request);
    const result = await siteAgent(site).invoke('writeSiteFile', site.slug, input.path, input.content);
    log('File written', site.name, input.path);
    send(response, 200, result);
    return true;
  }
  if (request.method === 'PUT') {
    const input = await body(request);
    const action = ['mkdir', 'delete', 'rename'].includes(input.action) ? input.action : '';
    if (!action || !input.path) throw new Error('Invalid file action');
    const result = await siteAgent(site).invoke('mutateSiteFile', site.slug, action, input.path, input.target);
    log(`File ${action}`, site.name, input.path);
    send(response, 200, result);
    return true;
  }
  return false;
}

module.exports = { handleFiles };
