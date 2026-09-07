const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const paths = require('./paths');
const { root } = require('./db');
const { renderTemplate } = require('./template');

function assertSlug(value) {
  const slug = String(value || '');
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug)) throw new Error('Invalid site slug');
  return slug;
}

function assertDomain(value) {
  const domain = String(value || '').trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error('Invalid domain');
  return domain;
}

function assertIp(value) {
  const ip = String(value || '').trim();
  if (!/^[0-9a-f:.]+$/i.test(ip) || ip.length > 64) throw new Error('Invalid IP address');
  return ip;
}

function generated(name) {
  const directory = path.join(paths.generatedRoot(), 'integrations');
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, name);
}

function writeOpenLiteSpeedConfig(site) {
  const slug = assertSlug(site.slug);
  const domain = site.domain || '_';
  const rootPath = path.join(process.env.PANEL_SITES_ROOT || path.join(root, 'sites'), slug, 'app');
  const content = [
    `virtualHost ${slug} {`,
    `  vhRoot ${rootPath}/`,
    `  configFile ${paths.openLiteSpeedRoot()}/conf/vhosts/${slug}.conf`,
    `  listeners HTTP { address *:${Number(site.port) || 80} }`,
    `  domain ${domain}`,
    '}',
    '',
  ].join('\n');
  const filePath = generated(`openlitespeed-${slug}.conf`);
  fs.writeFileSync(filePath, content, { mode: 0o640 });
  const vhostPath = generated(`openlitespeed-${slug}-vhost.conf`);
  fs.writeFileSync(vhostPath, renderTemplate('openlitespeed/vhost.conf.hbs', {
    site_root: rootPath,
    site_path: path.dirname(rootPath),
    server_name: domain,
  }), { mode: 0o640 });
  return filePath;
}

async function applyOpenLiteSpeedConfig(site, command) {
  const filePath = writeOpenLiteSpeedConfig(site);
  if (!paths.applySystem) return { applied: false, path: filePath };
  const target = path.join(paths.openLiteSpeedRoot(), 'conf', 'httpd-vhosts.conf');
  await command('install', ['-m', '0640', filePath, target]);
  await command('systemctl', ['reload', 'lsws']);
  return { applied: true, path: filePath };
}

async function controlOpenLiteSpeed(action, command) {
  const allowed = ['start', 'stop', 'restart', 'reload'];
  if (!allowed.includes(action)) throw new Error('Unsupported OpenLiteSpeed action');
  if (!paths.applySystem) return { applied: false, action };
  await command('systemctl', [action === 'reload' ? 'reload' : action, 'lsws']);
  return { applied: true, action };
}

function writeFail2BanJail() {
  const content = `[iqpanel-auth]\nenabled = true\nport = http,https\nfilter = iqpanel-auth\nlogpath = ${path.join(root, 'logs', 'auth.log')}\nmaxretry = 5\nbantime = 3600\n\n`;
  const filePath = generated('fail2ban-iqpanel.local');
  fs.writeFileSync(filePath, content, { mode: 0o640 });
  return filePath;
}

async function fail2banStatus(command) {
  try {
    const result = await command('fail2ban-client', ['status']);
    return { available: true, status: (result.stdout || '').trim() };
  } catch (error) {
    return { available: false, status: 'unavailable', error: error.message };
  }
}

async function configureFail2Ban(command) {
  const filePath = writeFail2BanJail();
  if (!paths.applySystem) return { applied: false, path: filePath };
  await command('install', ['-m', '0640', filePath, '/etc/fail2ban/jail.d/iqpanel.local']);
  await command('systemctl', ['restart', 'fail2ban']);
  return { applied: true, path: filePath };
}

function assertJail(value) {
  const jail = String(value || '');
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(jail)) throw new Error('Invalid Fail2Ban jail');
  return jail;
}

async function fail2banAction(action, jail, ip, command) {
  const allowed = ['ban', 'unban'];
  if (!allowed.includes(action)) throw new Error('Unsupported Fail2Ban action');
  const args = [action, assertJail(jail), assertIp(ip)];
  if (!paths.applySystem) return { applied: false, action, jail: args[1], ip: args[2] };
  await command('fail2ban-client', args);
  return { applied: true, action, jail: args[1], ip: args[2] };
}

function swapFile() {
  return process.env.PANEL_SWAP_PATH || path.join(root, 'swapfile');
}

function swapSizeMb(value) {
  const size = Number(value);
  if (!Number.isInteger(size) || size < 128 || size > 16384) throw new Error('Swap size must be between 128 and 16384 MB');
  return size;
}

async function swap(action, size, command) {
  if (!['enable', 'disable'].includes(action)) throw new Error('Unsupported swap action');
  const filePath = swapFile();
  if (action === 'disable') {
    const script = generated('swap-disable.sh');
    fs.writeFileSync(script, `swapoff ${filePath}\nrm -f ${filePath}\n`, { mode: 0o750 });
    if (!paths.applySystem) return { applied: false, action, path: script };
    await command('swapoff', [filePath]).catch(() => {});
    fs.rmSync(filePath, { force: true });
    return { applied: true, action, path: filePath };
  }
  const mb = swapSizeMb(size);
  const script = generated('swap-enable.sh');
  fs.writeFileSync(script, `fallocate -l ${mb}M ${filePath}\nchmod 0600 ${filePath}\nmkswap ${filePath}\nswapon ${filePath}\n`, { mode: 0o750 });
  if (!paths.applySystem) return { applied: false, action, size_mb: mb, path: script };
  await command('fallocate', ['-l', `${mb}M`, filePath]);
  await command('chmod', ['0600', filePath]);
  await command('mkswap', [filePath]);
  await command('swapon', [filePath]);
  return { applied: true, action, size_mb: mb, path: filePath };
}

function assertDevice(value) {
  const device = String(value || '').trim();
  if (!/^\/dev\/[A-Za-z0-9_./-]+$/.test(device) || device.includes('..')) throw new Error('Invalid disk device');
  return device;
}

async function extendDisk(device, mode, confirm, command) {
  const target = assertDevice(device);
  const operation = mode === 'partition' ? 'partition' : 'lvm';
  const script = generated(`disk-extension-${crypto.createHash('sha256').update(target).digest('hex').slice(0, 12)}.sh`);
  const commandLine = operation === 'lvm' ? `lvextend -r -l +100%FREE ${target}` : `growpart ${target.replace(/[0-9]+$/, '')} ${target.match(/[0-9]+$/)?.[0] || ''}`;
  fs.writeFileSync(script, `# Dry-run first; review the target before applying.\n${commandLine}\n`, { mode: 0o750 });
  if (!paths.applySystem || confirm !== true) return { applied: false, dry_run: true, device: target, mode: operation, path: script, message: 'Review the generated operation and confirm it before applying.' };
  if (operation === 'lvm') await command('lvextend', ['-r', '-l', '+100%FREE', target]);
  else await command('growpart', [target.replace(/[0-9]+$/, ''), target.match(/[0-9]+$/)?.[0] || '']);
  return { applied: true, dry_run: false, device: target, mode: operation, path: script };
}

function authorizedKeysPath() {
  return process.env.PANEL_AUTHORIZED_KEYS_PATH || (paths.applySystem ? '/root/.ssh/authorized_keys' : path.join(paths.generatedRoot(), 'ssh', 'authorized_keys'));
}

function validatePublicKey(value) {
  const key = String(value || '').trim();
  if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]+(?: [^\r\n]+)?$/.test(key)) throw new Error('Unsupported SSH public key');
  return key;
}

function manageAuthorizedKey(action, key) {
  if (!['add', 'remove'].includes(action)) throw new Error('Unsupported SSH key action');
  const publicKey = validatePublicKey(key);
  const filePath = authorizedKeysPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const entries = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean) : [];
  const next = action === 'add' ? [...new Set([...entries, publicKey])] : entries.filter((entry) => entry !== publicKey);
  fs.writeFileSync(filePath, next.length ? `${next.join('\n')}\n` : '', { mode: 0o600 });
  return { action, path: filePath, changed: entries.length !== next.length, fingerprint: crypto.createHash('sha256').update(publicKey).digest('base64url') };
}

function listAuthorizedKeys() {
  const filePath = authorizedKeysPath();
  if (!fs.existsSync(filePath)) return { path: filePath, keys: [] };
  return { path: filePath, keys: fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean) };
}

async function configureMail(domain, command) {
  const host = assertDomain(domain);
  const directory = path.join(paths.generatedRoot(), 'mail');
  fs.mkdirSync(directory, { recursive: true });
  const postfix = path.join(directory, 'main.cf');
  const dovecot = path.join(directory, 'dovecot.conf');
  fs.writeFileSync(postfix, `myhostname = ${host}\nmydestination = $myhostname, localhost\n`, { mode: 0o640 });
  fs.writeFileSync(dovecot, `protocols = imap\nmail_location = maildir:~/Maildir\n`, { mode: 0o640 });
  if (!paths.applySystem) return { applied: false, domain: host, paths: [postfix, dovecot] };
  await command('systemctl', ['enable', '--now', 'postfix']);
  await command('systemctl', ['enable', '--now', 'dovecot']);
  return { applied: true, domain: host, paths: [postfix, dovecot] };
}

async function mailStatus(command) {
  const result = {};
  for (const unit of ['postfix', 'dovecot']) {
    try { result[unit] = (await command('systemctl', ['is-active', unit])).stdout.trim() || 'unknown'; } catch { result[unit] = 'inactive'; }
  }
  return result;
}

async function installPhpMyAdmin(domain, command) {
  const host = domain ? assertDomain(domain) : 'localhost';
  const filePath = generated('phpmyadmin.conf');
  fs.writeFileSync(filePath, `server {\n  listen 127.0.0.1:8081;\n  server_name ${host};\n  root /usr/share/phpmyadmin;\n  index index.php;\n  location / { try_files $uri $uri/ /index.php?$query_string; }\n  location ~ \\.php$ { include snippets/fastcgi-php.conf; fastcgi_pass unix:/run/php/${paths.phpVersion}-fpm.sock; }\n}\n`, { mode: 0o640 });
  if (!paths.applySystem) return { applied: false, path: filePath, domain: host };
  await command('apt-get', ['install', '-y', '--no-install-recommends', 'phpmyadmin']);
  const target = path.join(paths.nginxRoot(), 'sites-available', 'iqpanel-phpmyadmin.conf');
  const enabled = path.join(paths.nginxRoot(), 'sites-enabled', 'iqpanel-phpmyadmin.conf');
  await command('install', ['-m', '0640', filePath, target]);
  await command('ln', ['-sfn', target, enabled]);
  await command('systemctl', ['reload', 'nginx']);
  return { applied: true, path: filePath, target, domain: host };
}

module.exports = {
  writeOpenLiteSpeedConfig,
  applyOpenLiteSpeedConfig: (site, command) => applyOpenLiteSpeedConfig(site, command),
  controlOpenLiteSpeed: (action, command) => controlOpenLiteSpeed(action, command),
  configureFail2Ban,
  fail2banStatus,
  fail2banAction: (action, jail, ip, command) => fail2banAction(action, jail, ip, command),
  swap: (action, size, command) => swap(action, size, command),
  extendDisk: (device, mode, confirm, command) => extendDisk(device, mode, confirm, command),
  manageAuthorizedKey,
  listAuthorizedKeys,
  configureMail: (domain, command) => configureMail(domain, command),
  mailStatus,
  installPhpMyAdmin: (domain, command) => installPhpMyAdmin(domain, command),
};
