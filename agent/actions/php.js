import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const PHP_ROOT = process.env.PANEL_PHP_FPM_ROOT ?? '/etc/php';

const ALLOWED_VERSIONS = ['7.4', '8.0', '8.1', '8.2', '8.3', '8.4', '8.5'];
const BASE_EXTENSIONS = ['fpm', 'cli', 'mysql', 'pgsql', 'mbstring', 'xml', 'curl', 'gd', 'zip', 'bcmath', 'intl', 'readline', 'tokenizer', 'common'];

function assertVersion(v) {
  if (!ALLOWED_VERSIONS.includes(v)) throw new Error(`Unsupported PHP version: ${v}`);
}

function aptRun(args, emit) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, DEBIAN_FRONTEND: 'noninteractive' };
    const proc = spawn('apt-get', args, { env });
    proc.stdout.on('data', (d) => emit?.('stdout', d.toString()));
    proc.stderr.on('data', (d) => emit?.('stderr', d.toString()));
    proc.on('close', (code) => {
      emit?.('exit', null, { code });
      if (code === 0) resolve();
      else reject(new Error(`apt-get exited ${code}`));
    });
  });
}

export const install = {
  timeout: 600_000,
  validate({ version }) { assertVersion(version); },
  async run({ version, extensions = [] }, emit) {
    const exts = [...new Set([...BASE_EXTENSIONS, ...extensions])];
    const pkgs = exts.map((e) => `php${version}-${e}`);
    emit?.('stdout', `Installing PHP ${version} with extensions: ${exts.join(', ')}\n`);
    await aptRun(['-y', 'update'], emit);
    await aptRun(['-y', 'install', ...pkgs], emit);
    execFileSync('systemctl', ['enable', '--now', `php${version}-fpm`], { encoding: 'utf8' });
    return { version, extensions: exts };
  },
};

export const remove = {
  timeout: 120_000,
  validate({ version }) { assertVersion(version); },
  async run({ version }, emit) {
    try { execFileSync('systemctl', ['stop', `php${version}-fpm`], { encoding: 'utf8' }); } catch {}
    await aptRun(['-y', 'remove', '--purge', `php${version}-*`], emit);
    return { removed: version };
  },
};

export const installedVersions = {
  async run() {
    const versions = {};
    for (const v of ALLOWED_VERSIONS) {
      const path = join(PHP_ROOT, v, 'fpm');
      versions[v] = existsSync(path);
    }
    return versions;
  },
};

export const setDefault = {
  validate({ version }) { assertVersion(version); },
  async run({ version }) {
    try { execFileSync('update-alternatives', ['--set', 'php', `/usr/bin/php${version}`], { encoding: 'utf8' }); } catch {}
    return { default: version };
  },
};

export const writePool = {
  validate({ slug, version, content }) {
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid slug');
    assertVersion(version);
    if (!content) throw new Error('content required');
  },
  async run({ slug, version, content }) {
    const poolDir = join(PHP_ROOT, version, 'fpm', 'pool.d');
    mkdirSync(poolDir, { recursive: true });
    const path = join(poolDir, `${slug}.conf`);
    writeFileSync(path, content, { mode: 0o644 });
    execFileSync('systemctl', ['reload', `php${version}-fpm`], { encoding: 'utf8' });
    return { path };
  },
};

export const removePool = {
  validate({ slug, version }) {
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid slug');
    assertVersion(version);
  },
  async run({ slug, version }) {
    const path = join(PHP_ROOT, version, 'fpm', 'pool.d', `${slug}.conf`);
    try { unlinkSync(path); } catch {}
    try { execFileSync('systemctl', ['reload', `php${version}-fpm`], { encoding: 'utf8' }); } catch {}
    return { removed: slug };
  },
};

export const readIni = {
  validate({ version }) { assertVersion(version); },
  async run({ version }) {
    const path = join(PHP_ROOT, version, 'fpm', 'php.ini');
    return { content: readFileSync(path, 'utf8'), path };
  },
};

export const writeIni = {
  validate({ version, content }) {
    assertVersion(version);
    if (!content || content.length > 256 * 1024) throw new Error('content invalid');
  },
  async run({ version, content }) {
    const path = join(PHP_ROOT, version, 'fpm', 'php.ini');
    writeFileSync(path, content, { mode: 0o644 });
    execFileSync('systemctl', ['reload', `php${version}-fpm`], { encoding: 'utf8' });
    return { path };
  },
};
