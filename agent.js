const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { root } = require('./db');
const paths = require('./paths');
const runtimePaths = require('./runtime-paths');
const { renderTemplate } = require('./template');
const { nginxListenPort, upstreamPort } = require('./ports');
const { applySiteOwnership, removeSiteUser, siteUserName } = require('./site-user');

const sitesRoot = process.env.PANEL_SITES_ROOT || path.join(root, 'sites');
fs.mkdirSync(sitesRoot, { recursive: true, mode: 0o750 });

function assertSlug(slug) {
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug)) throw new Error('Invalid site slug');
}

function sitePath(slug) { assertSlug(slug); return path.join(sitesRoot, slug); }

function safeSitePath(slug, relative = '') {
  const base = path.join(sitePath(slug), 'app');
  const resolved = path.resolve(base, String(relative || '.'));
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new Error('Path escapes site root');
  return resolved;
}

function listFiles(slug, relative = '.') {
  const directory = safeSitePath(slug, relative);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error('Directory not found');
  return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => {
    const full = path.join(directory, entry.name);
    const stats = fs.statSync(full);
    return { name: entry.name, type: entry.isDirectory() ? 'directory' : 'file', size: stats.size, modified_at: stats.mtime.toISOString() };
  }).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

function readSiteFile(slug, relative) {
  const filePath = safeSitePath(slug, relative);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error('File not found');
  if (fs.statSync(filePath).size > 2 * 1024 * 1024) throw new Error('File is too large to edit in the panel');
  return { path: relative, content: fs.readFileSync(filePath, 'utf8') };
}

function writeSiteFile(slug, relative, content) {
  const filePath = safeSitePath(slug, relative);
  if (typeof content !== 'string' || Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('File is too large');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { mode: 0o640 });
  return { path: relative, size: Buffer.byteLength(content) };
}

function mutateSiteFile(slug, action, relative, target) {
  const filePath = safeSitePath(slug, relative);
  if (action === 'mkdir') fs.mkdirSync(filePath, { recursive: true });
  else if (action === 'delete') fs.rmSync(filePath, { recursive: true, force: true });
  else if (action === 'rename') fs.renameSync(filePath, safeSitePath(slug, target));
  else throw new Error('Unsupported file action');
  return { ok: true };
}

async function wordpress(slug, action, args = []) {
  const app = sitePath(slug) + '/app';
  const allowed = {
    version: ['core', 'version'],
    plugins: ['plugin', 'list', '--format=json'],
    themes: ['theme', 'list', '--format=json'],
    core_update: ['core', 'update'],
    plugin_update: ['plugin', 'update', '--all'],
    theme_update: ['theme', 'update', '--all'],
  };
  if (['plugin_activate', 'plugin_deactivate'].includes(action)) {
    const plugin = String(args[0] || '');
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(plugin)) throw new Error('Invalid plugin slug');
    return command('wp', ['plugin', action === 'plugin_activate' ? 'activate' : 'deactivate', plugin], { cwd: app, env: { ...process.env, WP_CLI_ALLOW_ROOT: '1' } });
  }
  if (['theme_activate', 'theme_deactivate'].includes(action)) {
    const theme = String(args[0] || '');
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(theme)) throw new Error('Invalid theme slug');
    return command('wp', ['theme', action === 'theme_activate' ? 'activate' : 'deactivate', theme], { cwd: app, env: { ...process.env, WP_CLI_ALLOW_ROOT: '1' } });
  }
  if (!Object.hasOwn(allowed, action)) throw new Error('Unsupported WordPress action');
  return command('wp', [...allowed[action], ...args.map(String)], { cwd: app, env: { ...process.env, WP_CLI_ALLOW_ROOT: '1' } });
}

function wordpressBackup(slug) {
  assertSlug(slug);
  const directory = path.join(root, 'backups', slug, 'wordpress');
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${new Date().toISOString().replaceAll(':', '-')}.tar.gz`);
  return command('tar', ['--exclude=node_modules', '-czf', filePath, '-C', sitePath(slug), 'app']).then(() => ({ path: filePath, size: fs.statSync(filePath).size }));
}

function wordpressInstall(slug, options = {}) {
  assertSlug(slug);
  const app = path.join(sitePath(slug), 'app');
  const url = String(options.url || '').trim();
  const title = String(options.title || '').trim();
  const adminUser = String(options.admin_user || '').trim();
  const adminPassword = String(options.admin_password || '');
  const adminEmail = String(options.admin_email || '').trim();
  const dbName = String(options.db_name || '').trim();
  const dbUser = String(options.db_user || '').trim();
  const dbPassword = String(options.db_password || '');
  if (!/^https?:\/\/[^\s]+$/.test(url) || !title || !/^[a-zA-Z0-9_-]{1,32}$/.test(adminUser) || !adminPassword || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) throw new Error('Invalid WordPress installation settings');
  if (![dbName, dbUser].every((value) => /^[A-Za-z0-9_]{1,64}$/.test(value)) || !dbPassword) throw new Error('Invalid WordPress database settings');
  const args = ['core', 'install', `--url=${url}`, `--title=${title}`, `--admin_user=${adminUser}`, `--admin_password=${adminPassword}`, `--admin_email=${adminEmail}`, `--dbname=${dbName}`, `--dbuser=${dbUser}`, `--dbpass=${dbPassword}`, '--skip-email'];
  return command('wp', args, { cwd: app, env: { ...process.env, WP_CLI_ALLOW_ROOT: '1' } });
}

function wordpressRestore(slug, backupPath) {
  assertSlug(slug);
  const backupRoot = path.join(root, 'backups', slug, 'wordpress');
  const resolved = path.resolve(String(backupPath || ''));
  if (!resolved.startsWith(`${backupRoot}${path.sep}`) || !resolved.endsWith('.tar.gz')) throw new Error('Backup path is outside the WordPress backup directory');
  if (!fs.existsSync(resolved)) throw new Error('WordPress backup not found');
  const app = path.join(sitePath(slug), 'app');
  const temporary = path.join(sitePath(slug), `.restore-${Date.now()}`);
  fs.mkdirSync(temporary, { recursive: true, mode: 0o750 });
  return command('tar', ['-xzf', resolved, '-C', temporary]).then(() => {
    const restored = path.join(temporary, 'app');
    if (!fs.existsSync(restored)) throw new Error('Backup archive does not contain an app directory');
    fs.rmSync(app, { recursive: true, force: true });
    fs.renameSync(restored, app);
    fs.rmSync(temporary, { recursive: true, force: true });
    return { restored: true, path: resolved };
  }).catch((error) => {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  });
}

function wordpressStaging(slug, targetSlug) {
  assertSlug(slug);
  assertSlug(targetSlug);
  if (slug === targetSlug) throw new Error('Staging site must have a different slug');
  const source = path.join(sitePath(slug), 'app');
  const target = path.join(sitePath(targetSlug), 'app');
  if (fs.existsSync(target)) throw new Error('Staging site already exists');
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o750 });
  fs.cpSync(source, target, { recursive: true, filter: (entry) => !entry.includes(`${path.sep}node_modules${path.sep}`) });
  applySiteOwnership(targetSlug, path.dirname(target));
  return { source: slug, staging: targetSlug, path: target };
}

async function systemCapabilities() {
  const commands = ['nginx', 'apache2', 'lsws', 'certbot', 'docker', 'ufw', 'fail2ban-client', 'postfix', 'dovecot', 'php', 'wp', 'swapon', 'lsblk', 'lvextend', 'growpart', 'mysql', 'mariadb', 'psql', 'redis-cli', 'redis-server'];
  const available = {};
  for (const program of commands) {
    try { await command('sh', ['-c', `command -v ${program}`]); available[program] = true; } catch { available[program] = false; }
  }
  return { available, generated_config_root: root };
}

const packages = require('./packages');
const runtimes = require('./runtimes');

async function installPackage(packageName) {
  const name = String(packageName || '').trim();
  if (!packages.INSTALLABLE_PACKAGES.has(name)) throw new Error('Package is not allowlisted');
  if (!paths.applySystem) return { package: name, installed: false, applied: false, reason: 'PANEL_APPLY_SYSTEM is disabled' };
  const result = await command('apt-get', ['install', '-y', '--no-install-recommends', name]);
  const unit = packages.PACKAGE_UNITS[name];
  let unitResult = null;
  if (unit) {
    try {
      await command('systemctl', ['enable', '--now', unit]);
      unitResult = { unit, enabled: true };
    } catch (error) {
      unitResult = { unit, enabled: false, error: error.message };
    }
  }
  return { package: name, installed: true, applied: true, unit: unitResult, output: `${result.stdout || ''}${result.stderr || ''}`.slice(-4000) };
}

async function ensureOndrejPhp() {
  await command('apt-get', ['install', '-y', '--no-install-recommends', 'software-properties-common', 'ca-certificates', 'gnupg']);
  await command('add-apt-repository', ['-y', 'ppa:ondrej/php']);
  await command('apt-get', ['update']);
}

async function installPhpVersion(version, extensions) {
  const selected = packages.phpPackages(version, extensions);
  if (!paths.applySystem) {
    return { version: selected.version, installed: false, applied: false, reason: 'PANEL_APPLY_SYSTEM is disabled', extensions: selected.extensions };
  }
  await ensureOndrejPhp();
  const result = await command('apt-get', ['install', '-y', '--no-install-recommends', ...selected.packages]);
  await command('systemctl', ['enable', '--now', `php${selected.version}-fpm`]).catch(() => {});
  return {
    version: selected.version,
    installed: true,
    applied: true,
    extensions: selected.extensions,
    output: `${result.stdout || ''}${result.stderr || ''}`.slice(-4000),
  };
}

function listPhpVersions() {
  return {
    versions: runtimes.phpMajors(),
    discovered: runtimes.discoverPhpVersions(),
    default: process.env.PANEL_PHP_VERSION || null,
  };
}

function parseUnitList(stdout) {
  const units = [];
  for (const line of String(stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('UNIT ')) continue;
    const match = trimmed.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;
    const unit = match[1].endsWith('.service') ? match[1] : `${match[1]}.service`;
    if (!packages.UNIT_NAME_RE.test(unit)) continue;
    units.push({ unit, load: match[2], active: match[3], sub: match[4], description: match[5].trim() });
  }
  return units;
}

function parseUnitFiles(stdout) {
  const enabled = new Map();
  for (const line of String(stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('UNIT FILE')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const unit = parts[0].endsWith('.service') ? parts[0] : `${parts[0]}.service`;
    if (!packages.UNIT_NAME_RE.test(unit)) continue;
    enabled.set(unit, parts[1]);
  }
  return enabled;
}

async function listSystemdUnits() {
  let listed = { stdout: '' };
  let files = { stdout: '' };
  try {
    listed = await command('systemctl', ['list-units', '--type=service', '--all', '--no-pager', '--plain', '--no-legend']);
  } catch {
    listed = { stdout: '' };
  }
  try {
    files = await command('systemctl', ['list-unit-files', '--type=service', '--no-pager', '--plain', '--no-legend']);
  } catch {
    files = { stdout: '' };
  }
  const enabledMap = parseUnitFiles(files.stdout);
  const byName = new Map();
  for (const item of parseUnitList(listed.stdout)) {
    byName.set(item.unit, { ...item, enabled: enabledMap.get(item.unit) || 'unknown' });
  }
  for (const [unit, enabled] of enabledMap) {
    if (!byName.has(unit)) {
      byName.set(unit, { unit, load: 'not-found', active: 'inactive', sub: 'dead', description: '', enabled });
    }
  }
  return { services: [...byName.values()].sort((a, b) => a.unit.localeCompare(b.unit)) };
}

async function controlSystemUnit(unit, action) {
  return apply.controlSystemdUnit(packages.assertUnitName(unit), action, { command });
}

function command(program, args, options = {}) {
  const { input, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { ...spawnOptions, shell: false });
    if (input != null) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `${program} exited with ${code}`)));
  });
}

const panelUpdateFiles = [
  'app-http.js',
  'installer/iqpanel.service',
  'installer/iqpanel-agent.service',
  'package.json',
  'public/index.html',
];

function validatePanelArchiveListing(listing) {
  const entries = new Set();
  let topLevel = null;
  for (const rawEntry of String(listing || '').split('\n')) {
    const entry = rawEntry.trim().replace(/\/+$/, '');
    if (!entry) continue;
    if (entry.startsWith('/') || entry.includes('\\')) throw new Error('Panel update archive contains an unsafe path');
    const parts = entry.split('/');
    if (!topLevel) topLevel = parts[0];
    if (parts.some((part) => !part || part === '.' || part === '..') || parts[0] !== topLevel) throw new Error('Panel update archive contains an unsafe path');
    entries.add(entry);
  }
  if (!topLevel) throw new Error('Panel update archive is empty');
  for (const required of panelUpdateFiles) {
    if (!entries.has(`${topLevel}/${required}`)) throw new Error(`Panel update archive is missing ${required}`);
  }
  return topLevel;
}

function installPanelUnit(source, destination) {
  const temporary = `${destination}.iqpanel-update-${process.pid}`;
  fs.copyFileSync(source, temporary);
  fs.chmodSync(temporary, 0o644);
  fs.renameSync(temporary, destination);
}

function schedulePanelRestart() {
  const script = 'const { spawnSync } = require("node:child_process"); setTimeout(() => { spawnSync("/usr/bin/systemctl", ["restart", "iqpanel-agent.service"], { stdio: "ignore" }); spawnSync("/usr/bin/systemctl", ["restart", "iqpanel.service"], { stdio: "ignore" }); }, 1500);';
  const child = spawn(process.execPath, ['-e', script], { detached: true, stdio: 'ignore' });
  child.unref();
}

async function updatePanel() {
  if (!paths.applySystem) throw new Error('Panel self-update requires PANEL_APPLY_SYSTEM=1');

  const repo = String(process.env.PANEL_UPDATE_REPO || 'Iraqi-Open-Source/iQPanel').trim();
  const ref = String(process.env.PANEL_UPDATE_REF || 'main').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Invalid panel update repository');
  if (!/^[A-Za-z0-9._/-]+$/.test(ref) || ref.includes('..') || ref.startsWith('/') || ref.endsWith('/')) throw new Error('Invalid panel update ref');

  const appRoot = path.resolve(process.env.PANEL_APP_ROOT || '/opt/iqpanel');
  if (appRoot !== '/opt/iqpanel') throw new Error('Panel self-update is restricted to /opt/iqpanel');
  const parent = path.dirname(appRoot);
  const downloadRoot = fs.mkdtempSync('/tmp/iqpanel-update-');
  const stageRoot = fs.mkdtempSync(path.join(parent, '.iqpanel-update-'));
  const archive = path.join(downloadRoot, 'panel.tar.gz');
  const extractRoot = path.join(stageRoot, 'extract');
  const stagedApp = path.join(stageRoot, 'app');
  const backupRoot = path.join(parent, `.iqpanel-previous-${Date.now()}-${process.pid}`);
  let swapped = false;

  try {
    const [owner, name] = repo.split('/');
    const encodedRef = ref.split('/').map((part) => encodeURIComponent(part)).join('/');
    const url = `https://github.com/${owner}/${name}/archive/refs/heads/${encodedRef}.tar.gz`;
    await command('curl', ['-fsSL', '--connect-timeout', '15', '--max-time', '120', '--retry', '2', url, '-o', archive]);
    if (fs.statSync(archive).size > 50 * 1024 * 1024) throw new Error('Panel update archive is too large');
    const listing = await command('tar', ['-tzf', archive]);
    const topLevel = validatePanelArchiveListing(listing.stdout);
    const details = await command('tar', ['-tvzf', archive]);
    if (String(details.stdout || '').split('\n').some((line) => /^[lhbcps]/.test(line))) throw new Error('Panel update archive contains unsupported links');

    fs.mkdirSync(extractRoot, { recursive: true, mode: 0o700 });
    await command('tar', ['--no-same-owner', '--no-same-permissions', '-xzf', archive, '-C', extractRoot]);
    const extracted = path.join(extractRoot, topLevel);
    if (!fs.existsSync(extracted) || !fs.lstatSync(extracted).isDirectory()) throw new Error('Panel update archive has no application directory');
    for (const required of panelUpdateFiles) {
      const requiredPath = path.join(extracted, required);
      if (!fs.existsSync(requiredPath) || !fs.lstatSync(requiredPath).isFile()) throw new Error(`Panel update file is invalid: ${required}`);
    }
    fs.renameSync(extracted, stagedApp);
    await command('chown', ['-R', 'root:root', stagedApp]);
    await command('chmod', ['-R', 'go-w', stagedApp]);

    fs.mkdirSync(paths.systemdRoot(), { recursive: true, mode: 0o755 });
    installPanelUnit(path.join(stagedApp, 'installer', 'iqpanel.service'), path.join(paths.systemdRoot(), 'iqpanel.service'));
    installPanelUnit(path.join(stagedApp, 'installer', 'iqpanel-agent.service'), path.join(paths.systemdRoot(), 'iqpanel-agent.service'));
    await command('systemctl', ['daemon-reload']);

    if (fs.existsSync(appRoot)) {
      if (!fs.lstatSync(appRoot).isDirectory()) throw new Error('Panel application root is not a directory');
      fs.renameSync(appRoot, backupRoot);
    }
    fs.renameSync(stagedApp, appRoot);
    swapped = true;
    schedulePanelRestart();
    return { updated: true, repo, ref, restart_scheduled: true };
  } catch (error) {
    if (swapped && fs.existsSync(backupRoot)) {
      fs.rmSync(appRoot, { recursive: true, force: true });
      fs.renameSync(backupRoot, appRoot);
    }
    throw error;
  } finally {
    fs.rmSync(downloadRoot, { recursive: true, force: true });
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function createSite(slug) {
  const directory = sitePath(slug);
  const sshDirectory = path.join(directory, '.ssh');
  fs.mkdirSync(path.join(directory, 'app'), { recursive: true, mode: 0o750 });
  fs.mkdirSync(sshDirectory, { recursive: true, mode: 0o700 });
  const keyPath = path.join(sshDirectory, 'id_ed25519');
  if (!fs.existsSync(keyPath)) {
    execKeygen(keyPath);
  }
  const provisioned = applySiteOwnership(slug, directory);
  return {
    directory,
    keyPath,
    publicKey: fs.readFileSync(`${keyPath}.pub`, 'utf8').trim(),
    run_as_user: provisioned.user,
    user_script: provisioned.path,
    user_applied: provisioned.applied,
  };
}

function execKeygen(keyPath) {
  execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', keyPath, '-N', '', '-C', 'iqpanel-site'], { stdio: 'ignore' });
  fs.chmodSync(keyPath, 0o600);
  fs.chmodSync(`${keyPath}.pub`, 0o644);
}

async function cloneRepository(slug, repoUrl) {
  const directory = sitePath(slug);
  const keyPath = path.join(directory, '.ssh', 'id_ed25519');
  if (!/^git@[\w.-]+:[\w./-]+(?:\.git)?$/.test(repoUrl)) throw new Error('Only SSH Git URLs are supported');
  const appPath = path.join(directory, 'app');
  if (fs.existsSync(path.join(appPath, '.git'))) {
    const pulled = await command('git', ['-C', appPath, 'pull', '--ff-only'], { env: { ...process.env, GIT_SSH_COMMAND: `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new` } });
    applySiteOwnership(slug, directory);
    return pulled;
  }
  fs.rmSync(appPath, { recursive: true, force: true });
  fs.mkdirSync(appPath, { recursive: true });
  const cloned = await command('git', ['clone', repoUrl, appPath], { env: { ...process.env, GIT_SSH_COMMAND: `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new` } });
  applySiteOwnership(slug, directory);
  return cloned;
}

async function repositoryHead(slug) {
  const appPath = path.join(sitePath(slug), 'app');
  if (!fs.existsSync(path.join(appPath, '.git'))) return { sha: null };
  const result = await command('git', ['-C', appPath, 'rev-parse', 'HEAD']);
  return { sha: (result.stdout || '').trim() || null };
}

async function checkoutRepository(slug, sha) {
  const normalized = String(sha || '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(normalized)) throw new Error('Invalid commit SHA');
  const appPath = path.join(sitePath(slug), 'app');
  if (!fs.existsSync(path.join(appPath, '.git'))) throw new Error('Repository not initialized');
  await command('git', ['-C', appPath, 'cat-file', '-e', `${normalized}^{commit}`]);
  await command('git', ['-C', appPath, 'checkout', '--detach', normalized]);
  const head = await command('git', ['-C', appPath, 'rev-parse', 'HEAD']);
  return { sha: (head.stdout || '').trim() };
}

function nginxTemplateVars(site) {
  const listenPort = nginxListenPort(site);
  return {
    slug: site.slug,
    listen_port: listenPort,
    server_name: site.domain || '_',
    site_root: path.join(sitePath(site.slug), 'app'),
    site_path: sitePath(site.slug),
    upstream_port: upstreamPort(site) || listenPort,
    run_as_user: site.run_as_user || siteUserName(site.slug),
  };
}

function writeNginxConfig(site) {
  fs.mkdirSync(path.join(paths.generatedRoot(), 'nginx'), { recursive: true });
  const vars = nginxTemplateVars(site);
  let template = 'nginx/proxy.conf.hbs';
  if (site.type === 'php') template = 'nginx/php.conf.hbs';
  else if (site.type === 'static') template = 'nginx/static.conf.hbs';
  const filePath = paths.nginxGenerated(site.slug);
  fs.writeFileSync(filePath, renderTemplate(template, vars), { mode: 0o640 });
  return filePath;
}

function writePhpPool(site) {
  fs.mkdirSync(path.join(paths.generatedRoot(), 'php-fpm'), { recursive: true });
  const version = site.runtime_version || paths.phpVersion;
  const filePath = paths.phpPoolGenerated(site.slug);
  fs.writeFileSync(filePath, renderTemplate('php-fpm/pool.conf.hbs', {
    slug: site.slug,
    memory_limit: site.memory_limit || '256M',
    upload_max_filesize: site.upload_max_filesize || '64M',
    run_as_user: site.run_as_user || siteUserName(site.slug),
  }), { mode: 0o640 });
  return { filePath, version };
}

function writeSystemdTemplate(site, template = 'laravel-queue') {
  fs.mkdirSync(path.join(paths.generatedRoot(), 'systemd'), { recursive: true });
  const filePath = paths.systemdGenerated(site.slug, template);
  fs.writeFileSync(filePath, renderTemplate('systemd/laravel-queue.service.hbs', {
    slug: site.slug,
    php_version: site.runtime_version || paths.phpVersion,
    site_path: sitePath(site.slug),
    run_as_user: site.run_as_user || siteUserName(site.slug),
  }), { mode: 0o640 });
  return { filePath, template, unitName: `panel-${site.slug}-${template}` };
}


const apply = require('./agent-apply');

async function applyNginxConfig(site) {
  return apply.applyNginxConfig(site, { writeNginxConfig, command });
}

async function applyPhpPool(site) {
  return apply.applyPhpPool(site, { writePhpPool, command });
}

async function applySystemdUnit(site, template = 'laravel-queue') {
  return apply.applySystemdUnit(site, template, { writeSystemdTemplate, command });
}

async function controlSystemdUnit(unitName, action) {
  return apply.controlSystemdUnit(unitName, action, { command });
}

function removeNginxConfig(slug) {
  return apply.removeNginxConfig(slug, assertSlug);
}

function removePhpPool(slug, version = paths.phpVersion) {
  return apply.removePhpPool(slug, version, assertSlug);
}

async function removeSystemdUnits(slug) {
  return apply.removeSystemdUnits(slug, assertSlug, command);
}

async function createBackup(site) {
  const directory = path.join(root, 'backups', site.slug, new Date().toISOString().replaceAll(':', '-'));
  fs.mkdirSync(directory, { recursive: true });
  const archivePath = path.join(directory, 'files.tar.gz');
  await command('tar', ['--exclude=node_modules', '--exclude=vendor', '-czf', archivePath, '-C', sitePath(site.slug), 'app']);
  return { path: archivePath, size: fs.statSync(archivePath).size };
}

async function ensureSiteVenv(site) {
  const base = sitePath(site.slug);
  const venvPath = path.join(base, 'venv');
  const python = runtimePaths.pythonBinary(site.python_version || site.runtime_version || '3.12');
  if (!fs.existsSync(path.join(venvPath, 'bin', 'python3'))) {
    await command(python, ['-m', 'venv', venvPath], { cwd: base });
  }
  applySiteOwnership(site.slug, base);
  return venvPath;
}

const allowedInstallCommands = {
  php: [['composer', ['install', '--no-dev', '--optimize-autoloader']], ['php', ['artisan', 'optimize:clear']]],
  node: [['npm', ['ci']], ['npm', ['run', 'build']]],
  python: [],
  static: [['npm', ['ci']], ['npm', ['run', 'build']]],
};

async function installSite(site) {
  const output = [];
  const app = path.join(sitePath(site.slug), 'app');
  if (site.type === 'python') {
    const venvPath = await ensureSiteVenv(site);
    const pip = path.join(venvPath, 'bin', 'pip');
    const requirements = path.join(app, 'requirements.txt');
    if (fs.existsSync(requirements)) {
      const result = await command(pip, ['install', '-r', 'requirements.txt'], { cwd: app });
      output.push(`${pip} install -r requirements.txt\n${result.stdout}${result.stderr}`);
    }
  } else {
    for (const [program, args] of allowedInstallCommands[site.type] || []) {
      const result = await command(program, args, { cwd: app });
      output.push(`${program} ${args.join(' ')}\n${result.stdout}${result.stderr}`);
    }
  }
  applySiteOwnership(site.slug, sitePath(site.slug));
  return output.join('\n');
}

async function removeSite(slug, options = {}) {
  assertSlug(slug);
  removeNginxConfig(slug);
  removePhpPool(slug, options.runtime_version || paths.phpVersion);
  await removeSystemdUnits(slug);
  if (paths.applySystem) {
    await command('systemctl', ['reload', 'nginx']).catch(() => {});
    await command('systemctl', ['reload', `php${options.runtime_version || paths.phpVersion}-fpm`]).catch(() => {});
  }
  fs.rmSync(sitePath(slug), { recursive: true, force: true });
  const user = options.run_as_user || siteUserName(slug);
  const userResult = removeSiteUser(user, { removeUser: options.remove_user !== false, slug });
  return { removed: true, slug, run_as_user: user, user_removed: userResult.removed };
}

function migrateSiteUser(slug) {
  const directory = sitePath(slug);
  fs.mkdirSync(path.join(directory, 'app'), { recursive: true, mode: 0o750 });
  const provisioned = applySiteOwnership(slug, directory);
  return { slug, run_as_user: provisioned.user, applied: provisioned.applied, path: provisioned.path };
}

module.exports = {
  createSite,
  cloneRepository,
  repositoryHead,
  checkoutRepository,
  writeNginxConfig,
  writePhpPool,
  writeSystemdTemplate,
  applyNginxConfig,
  applyPhpPool,
  applySystemdUnit,
  controlSystemdUnit,
  removeNginxConfig,
  removePhpPool,
  removeSystemdUnits,
  createBackup,
  installSite,
  removeSite,
  sitePath,
  assertSlug,
  listFiles,
  readSiteFile,
  writeSiteFile,
  mutateSiteFile,
  wordpress,
  wordpressBackup,
  wordpressRestore,
  wordpressStaging,
  wordpressInstall,
  systemCapabilities,
  installPackage,
  installPhpVersion,
  listPhpVersions,
  listSystemdUnits,
  controlSystemUnit,
  command,
  validatePanelArchiveListing,
  updatePanel,
  siteUserName,
  applySiteOwnership,
  migrateSiteUser,
};
