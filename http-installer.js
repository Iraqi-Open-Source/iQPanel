const { send, body, log, queue } = require('./http-shared');

const PACKAGE_ALLOWLIST = new Set([
  'nginx', 'apache2', 'certbot', 'php', 'php-fpm', 'mysql-server', 'mariadb-server',
  'postgresql', 'docker-ce', 'docker-compose-plugin', 'fail2ban', 'postfix', 'dovecot-core',
  'phpmyadmin', 'python3-venv', 'python3-pip', 'nodejs', 'npm', 'unzip', 'ufw',
]);

async function handleInstaller(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/system/packages') {
    send(response, 200, { packages: [...PACKAGE_ALLOWLIST].sort() });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/system/packages/install') {
    const input = await body(request);
    const packages = Array.isArray(input.packages) ? input.packages : [input.package];
    const selected = [...new Set(packages.map((item) => String(item || '').trim()))].filter(Boolean);
    if (!selected.length || selected.some((item) => !PACKAGE_ALLOWLIST.has(item))) {
      send(response, 400, { error: 'Every package must be on the allowlist' });
      return true;
    }
    const jobs = selected.map((packageName) => queue.enqueue('installPackage', { package: packageName }));
    log('Package installation queued', 'system', selected.join(', '));
    send(response, 202, { status: 'queued', jobs: jobs.map((job) => job.id), packages: selected });
    return true;
  }
  return false;
}

module.exports = { handleInstaller, PACKAGE_ALLOWLIST };
