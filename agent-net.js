const fs = require('node:fs');
const path = require('node:path');
const paths = require('./paths');

function assertDomain(domain) {
  if (!/^[A-Za-z0-9.-]+$/.test(String(domain || ''))) throw new Error('Invalid domain');
  return String(domain);
}

function assertPort(port) {
  const number = Number(port);
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error('Invalid port');
  return number;
}

async function requestCertificate(site, command) {
  const domain = assertDomain(site.domain);
  const directory = path.join(paths.generatedRoot(), 'ssl');
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${site.slug}.sh`);
  const plugin = site.webserver === 'apache' ? '--apache' : '--nginx';
  fs.writeFileSync(filePath, `certbot ${plugin} -d ${domain} --non-interactive --agree-tos --register-unsafely-without-email\n`, { mode: 0o750 });
  if (!paths.applySystem) return { applied: false, path: filePath };
  await command('certbot', [plugin.slice(2), '-d', domain, '--non-interactive', '--agree-tos', '--register-unsafely-without-email']);
  return { applied: true, path: filePath };
}

async function openSitePort(port, command) {
  const number = assertPort(port);
  const directory = path.join(paths.generatedRoot(), 'ufw');
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${number}.allow`);
  fs.writeFileSync(filePath, `ufw allow ${number}/tcp\n`, { mode: 0o640 });
  if (!paths.applySystem) return { applied: false, path: filePath };
  await command('ufw', ['allow', `${number}/tcp`]);
  return { applied: true, path: filePath };
}

async function closeSitePort(port, command) {
  const number = assertPort(port);
  const directory = path.join(paths.generatedRoot(), 'ufw');
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${number}.delete`);
  fs.writeFileSync(filePath, `ufw delete allow ${number}/tcp\n`, { mode: 0o640 });
  if (!paths.applySystem) return { applied: false, path: filePath };
  await command('ufw', ['delete', 'allow', `${number}/tcp`]);
  return { applied: true, path: filePath };
}

module.exports = { requestCertificate, openSitePort, closeSitePort };
