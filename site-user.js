const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const paths = require('./paths');

const USER_PREFIX = 'iqpanel-';

function siteUserName(slug) {
  const normalized = String(slug || '');
  if (USER_PREFIX.length + normalized.length <= 32) return `${USER_PREFIX}${normalized}`;
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 6);
  const keep = 32 - USER_PREFIX.length - 1 - hash.length;
  return `${USER_PREFIX}${normalized.slice(0, keep)}-${hash}`;
}

function isManagedSiteUser(user) {
  return /^iqpanel-[a-z0-9-]{1,24}$/.test(String(user || ''));
}

function userExists(user) {
  try {
    execFileSync('id', ['-u', user], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function writeProvisionScript(slug, homeDir, user) {
  const directory = path.join(paths.generatedRoot(), 'users');
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${slug}.sh`);
  const script = [
    '#!/bin/sh',
    `if ! id -u ${user} >/dev/null 2>&1; then`,
    `  useradd --system --home-dir ${homeDir} --no-create-home --shell /usr/sbin/nologin --comment 'iQPanel site ${slug}' ${user}`,
    'fi',
    `usermod -aG ${user} www-data 2>/dev/null || true`,
    `chown -R ${user}:${user} ${homeDir}`,
    `chmod 0750 ${homeDir}`,
    `chmod 0700 ${homeDir}/.ssh 2>/dev/null || true`,
    '',
  ].join('\n');
  fs.writeFileSync(filePath, script, { mode: 0o750 });
  return filePath;
}

function writeRemovalScript(slug, user) {
  const directory = path.join(paths.generatedRoot(), 'users');
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${slug}.remove.sh`);
  fs.writeFileSync(filePath, `#!/bin/sh\nuserdel --force ${user} 2>/dev/null || true\n`, { mode: 0o750 });
  return filePath;
}

function applySiteOwnership(slug, homeDir) {
  const user = siteUserName(slug);
  const scriptPath = writeProvisionScript(slug, homeDir, user);
  try { fs.chmodSync(homeDir, 0o750); } catch {}
  if (!paths.applySystem) return { user, applied: false, path: scriptPath };
  try {
    if (!userExists(user)) {
      execFileSync('useradd', [
        '--system',
        '--home-dir', homeDir,
        '--no-create-home',
        '--shell', '/usr/sbin/nologin',
        '--comment', `iQPanel site ${slug}`,
        user,
      ], { stdio: 'ignore' });
    }
    try { execFileSync('usermod', ['-aG', user, 'www-data'], { stdio: 'ignore' }); } catch {}
    execFileSync('chown', ['-R', `${user}:${user}`, homeDir], { stdio: 'ignore' });
    return { user, applied: true, path: scriptPath };
  } catch (error) {
    throw new Error(`Site user provision failed: ${error.message}`);
  }
}

function removeSiteUser(user, { removeUser = true, slug } = {}) {
  if (!removeUser || !isManagedSiteUser(user)) return { removed: false, user };
  const scriptPath = writeRemovalScript(slug || user, user);
  if (!paths.applySystem) return { removed: false, user, path: scriptPath };
  try {
    execFileSync('userdel', ['--force', user], { stdio: 'ignore' });
    return { removed: true, user, path: scriptPath };
  } catch {
    return { removed: false, user, path: scriptPath };
  }
}

function resolveRunAsUser({ site, requested, escalate = false }) {
  const siteUser = site ? (site.run_as_user || siteUserName(site.slug)) : 'www-data';
  const wanted = String(requested || '').trim();
  if (!wanted || wanted === siteUser) return siteUser;
  if (!escalate) throw new Error('Escalation required to run as a different user');
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(wanted)) throw new Error('Invalid run-as user');
  return wanted;
}

function needsUserMigration(site) {
  const user = String(site?.run_as_user || '').trim();
  return !user || user === 'www-data';
}

module.exports = {
  siteUserName,
  isManagedSiteUser,
  userExists,
  applySiteOwnership,
  removeSiteUser,
  resolveRunAsUser,
  needsUserMigration,
};
