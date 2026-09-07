const { send, body, log, queue, agentClient } = require('./http-shared');
const { publicSettings } = require('./http-settings');
const packages = require('./packages');

const PACKAGE_ALLOWLIST = packages.INSTALLABLE_PACKAGES;

function activeServerId() {
  return publicSettings().active_server_id || 'local';
}

async function handleInstaller(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/system/packages') {
    send(response, 200, { packages: [...PACKAGE_ALLOWLIST].sort() });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/system/packages/install') {
    const input = await body(request);
    const names = Array.isArray(input.packages) ? input.packages : [input.package];
    const selected = [...new Set(names.map((item) => String(item || '').trim()))].filter(Boolean);
    if (!selected.length || selected.some((item) => !PACKAGE_ALLOWLIST.has(item))) {
      send(response, 400, { error: 'Every package must be on the allowlist' });
      return true;
    }
    const serverId = activeServerId();
    const jobs = selected.map((packageName) => queue.enqueue('installPackage', { package: packageName, server_id: serverId }));
    log('Package installation queued', 'system', selected.join(', '));
    send(response, 202, { status: 'queued', jobs: jobs.map((job) => job.id), packages: selected });
    return true;
  }
  if (request.method === 'GET' && pathname === '/api/system/php') {
    const result = await agentClient.forServer(activeServerId()).invoke('listPhpVersions');
    send(response, 200, result);
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/system/php/install') {
    const input = await body(request);
    let selected;
    try {
      selected = packages.phpPackages(input.version, input.extensions);
    } catch (error) {
      send(response, 400, { error: error.message });
      return true;
    }
    const job = queue.enqueue('installPhp', {
      version: selected.version,
      extensions: selected.extensions,
      server_id: activeServerId(),
    });
    log('PHP installation queued', selected.version);
    send(response, 202, { status: 'queued', job_id: job.id, version: selected.version, extensions: selected.extensions });
    return true;
  }
  return false;
}

module.exports = { handleInstaller, PACKAGE_ALLOWLIST };
