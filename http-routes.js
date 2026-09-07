const fs = require('node:fs');
const path = require('node:path');
const { send, publicRoot } = require('./http-shared');
const { handleAuth } = require('./http-auth');
const { handleData } = require('./http-data');
const { handleSites } = require('./http-sites');
const { handleServices } = require('./http-services');
const { handleCron } = require('./http-cron');
const { handleRuntimes } = require('./http-runtimes');
const { handleDocker } = require('./http-docker');
const { handleServers } = require('./http-servers');
const { handleSettings } = require('./http-settings');
const { handleTerminal } = require('./http-terminal');
const { handleSiteCreate } = require('./http-site-create');
const { handleSiteExtras } = require('./http-site-extras');
const { handleFiles } = require('./http-files');
const { handleWordpress } = require('./http-wordpress');
const { handleSystem } = require('./http-system');

const publicDir = path.join(publicRoot, 'public');
const staticExtensions = new Set(['.html', '.css', '.js', '.svg', '.png', '.ico', '.woff2']);

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (await handleAuth(request, response, url.pathname)) return;
  if (url.pathname.startsWith('/api/')) {
    if (await handleRuntimes(request, response, url.pathname)) return;
    if (await handleDocker(request, response, url.pathname)) return;
    if (await handleServers(request, response, url.pathname)) return;
    if (await handleSettings(request, response, url.pathname)) return;
    if (await handleTerminal(request, response, url.pathname)) return;
    if (await handleSystem(request, response, url.pathname)) return;
    if (await handleData(request, response, url.pathname)) return;
    if (await handleCron(request, response, url.pathname)) return;
    if (await handleServices(request, response, url.pathname)) return;
    if (await handleSiteCreate(request, response, url.pathname)) return;
    if (await handleSiteExtras(request, response, url.pathname)) return;
    if (await handleFiles(request, response, url.pathname)) return;
    if (await handleWordpress(request, response, url.pathname)) return;
    if (await handleSites(request, response, url.pathname)) return;
    send(response, 404, { error: 'Not found' });
    return;
  }
  if (request.method !== 'GET') {
    send(response, 405, { error: 'Method not allowed' });
    return;
  }
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const extension = path.extname(relative);
  if (!staticExtensions.has(extension)) {
    send(response, 404, { error: 'Not found' }, { 'content-type': 'text/plain' });
    return;
  }
  const filePath = path.resolve(publicDir, relative);
  if (!filePath.startsWith(path.resolve(publicDir)) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(response, 404, { error: 'Not found' }, { 'content-type': 'text/plain' });
    return;
  }
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
  if (path.basename(filePath) === 'index.html') {
    const html = fs.readFileSync(filePath, 'utf8').replace('</body>', '<script src="/phase2.js"></script><script src="/phase3a.js"></script></body>');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }
  response.writeHead(200, { 'content-type': `${types[extension] || 'application/octet-stream'}; charset=utf-8` });
  fs.createReadStream(filePath).pipe(response);
}

module.exports = { handleRequest, publicDir };
