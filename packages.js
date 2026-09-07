const INSTALLABLE_PACKAGES = new Set([
  'nginx', 'apache2', 'certbot', 'php', 'php-fpm', 'mysql-server', 'mariadb-server',
  'postgresql', 'postgresql-contrib', 'docker-ce', 'docker.io', 'docker-compose-plugin',
  'fail2ban', 'postfix', 'dovecot-core', 'phpmyadmin', 'python3-venv', 'python3-pip',
  'nodejs', 'npm', 'unzip', 'ufw', 'redis-server', 'composer',
]);

const PACKAGE_UNITS = {
  nginx: 'nginx.service',
  apache2: 'apache2.service',
  php: 'php-fpm.service',
  'php-fpm': 'php-fpm.service',
  'mysql-server': 'mysql.service',
  'mariadb-server': 'mariadb.service',
  postgresql: 'postgresql.service',
  'docker-ce': 'docker.service',
  'docker.io': 'docker.service',
  fail2ban: 'fail2ban.service',
  postfix: 'postfix.service',
  'dovecot-core': 'dovecot.service',
  'redis-server': 'redis-server.service',
};

const PHP_VERSION_RE = /^\d+\.\d+$/;
const PHP_DEFAULT_EXTENSIONS = ['fpm', 'cli', 'mysql', 'pgsql', 'mbstring', 'xml', 'curl', 'gd', 'zip', 'bcmath', 'intl'];
const PHP_ALLOWED_EXTENSIONS = new Set([...PHP_DEFAULT_EXTENSIONS, 'common']);
const UNIT_NAME_RE = /^[A-Za-z0-9@._-]+\.service$/;
const UNIT_ACTIONS = new Set(['start', 'stop', 'restart', 'enable', 'disable']);

function assertUnitName(unit) {
  const name = String(unit || '').trim();
  if (!UNIT_NAME_RE.test(name)) throw new Error('Invalid systemd unit name');
  return name;
}

function assertPhpVersion(version) {
  const value = String(version || '').trim();
  if (!PHP_VERSION_RE.test(value)) throw new Error('Invalid PHP version');
  return value;
}

function phpPackages(version, extensions) {
  const ver = assertPhpVersion(version);
  const list = Array.isArray(extensions) && extensions.length ? extensions.map(String) : PHP_DEFAULT_EXTENSIONS;
  if (list.some((item) => !PHP_ALLOWED_EXTENSIONS.has(item))) throw new Error('Invalid PHP extension');
  return { version: ver, extensions: list, packages: list.map((ext) => `php${ver}-${ext}`) };
}

module.exports = {
  INSTALLABLE_PACKAGES,
  PACKAGE_UNITS,
  PHP_VERSION_RE,
  PHP_DEFAULT_EXTENSIONS,
  PHP_ALLOWED_EXTENSIONS,
  UNIT_NAME_RE,
  UNIT_ACTIONS,
  assertUnitName,
  assertPhpVersion,
  phpPackages,
};
