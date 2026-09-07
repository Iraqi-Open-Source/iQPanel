const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { root } = require('./db');
const paths = require('./paths');
const { renderTemplate } = require('./template');
const { nginxListenPort, upstreamPort } = require('./ports');

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
  const allowed = {
    version: ['core', 'version'],
    plugins: ['plugin', 'list', '--format=json'],
    themes: ['theme', 'list', '--format=json'],
    core_update: ['core', 'update'],
    plugin_update: ['plugin', 'update', '--all'],
    theme_update: ['theme', 'update', '--all'],
  };
  if (!Object.hasOwn(allowed, action)) throw new Error('Unsupported WordPress action');
  const app = sitePath(slug) + '/app';
  return command('wp', [...allowed[action], ...args.map(String)], { cwd: app, env: { ...process.env, WP_CLI_ALLOW_ROOT: '1' } });
}

async function systemCapabilities() {
  const commands = ['nginx', 'apache2', 'certbot', 'docker', 'ufw', 'fail2ban-client', 'wp', 'swapon', 'lsblk'];
  const available = {};
  for (const program of commands) {
    try { await command('sh', ['-c', `command -v ${program}`]); available[program] = true; } catch { available[program] = false; }
  }
  return { available, generated_config_root: root };
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

function createSite(slug) {
  const directory = sitePath(slug);
  const sshDirectory = path.join(directory, '.ssh');
  fs.mkdirSync(path.join(directory, 'app'), { recursive: true, mode: 0o750 });
  fs.mkdirSync(sshDirectory, { recursive: true, mode: 0o700 });
  const keyPath = path.join(sshDirectory, 'id_ed25519');
  if (!fs.existsSync(keyPath)) {
    execKeygen(keyPath);
  }
  return { directory, keyPath, publicKey: fs.readFileSync(`${keyPath}.pub`, 'utf8').trim() };
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
    return command('git', ['-C', appPath, 'pull', '--ff-only'], { env: { ...process.env, GIT_SSH_COMMAND: `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new` } });
  }
  fs.rmSync(appPath, { recursive: true, force: true });
  fs.mkdirSync(appPath, { recursive: true });
  return command('git', ['clone', repoUrl, appPath], { env: { ...process.env, GIT_SSH_COMMAND: `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new` } });
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

const allowedInstallCommands = {
  php: [['composer', ['install', '--no-dev', '--optimize-autoloader']], ['php', ['artisan', 'optimize:clear']]],
  node: [['npm', ['ci']], ['npm', ['run', 'build']]],
  python: [['python3', ['-m', 'pip', 'install', '-r', 'requirements.txt']]],
  static: [['npm', ['ci']], ['npm', ['run', 'build']]],
};

async function installSite(site) {
  const output = [];
  const app = path.join(sitePath(site.slug), 'app');
  for (const [program, args] of allowedInstallCommands[site.type] || []) {
    const result = await command(program, args, { cwd: app });
    output.push(`${program} ${args.join(' ')}\n${result.stdout}${result.stderr}`);
  }
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
  return { removed: true, slug };
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
  listFiles,
  readSiteFile,
  writeSiteFile,
  mutateSiteFile,
  wordpress,
  systemCapabilities,
  command,
};
