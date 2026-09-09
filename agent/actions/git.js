import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SITES_ROOT = process.env.PANEL_SITES_ROOT ?? '/var/www/sites';

function siteKeyPath(slug) {
  return join(SITES_ROOT, slug, '.ssh', 'id_ed25519');
}

function gitEnv(slug) {
  const keyPath = siteKeyPath(slug);
  return {
    ...process.env,
    GIT_SSH_COMMAND: `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new -o BatchMode=yes`,
  };
}

function runGit(args, cwd, env, emit, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd, env });
    let out = '';
    proc.stdout.on('data', (d) => { out += d; emit?.('stdout', d.toString()); });
    proc.stderr.on('data', (d) => { out += d; emit?.('stderr', d.toString()); });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('git timed out')); }, timeout);
    proc.on('close', (code) => {
      clearTimeout(timer);
      emit?.('exit', null, { code });
      if (code === 0) resolve(out);
      else reject(new Error(`git exited ${code}\n${out}`));
    });
  });
}

function validateSlug(slug) {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid slug');
}

function validateUrl(url) {
  if (!url) throw new Error('url required');
  if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(url)) throw new Error('Invalid repo URL scheme');
}

export const keygen = {
  validate({ slug }) { validateSlug(slug); },
  async run({ slug }) {
    const sshDir = join(SITES_ROOT, slug, '.ssh');
    const keyPath = join(sshDir, 'id_ed25519');
    mkdirSync(sshDir, { recursive: true, mode: 0o700 });
    if (!existsSync(keyPath)) {
      execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', keyPath, '-N', '', '-C', `iqpanel-${slug}`], { encoding: 'utf8' });
      chmodSync(keyPath, 0o600);
    }
    const pub = execFileSync('cat', [`${keyPath}.pub`], { encoding: 'utf8' }).trim();
    return { publicKey: pub, path: keyPath };
  },
};

export const lsRemote = {
  timeout: 30_000,
  validate({ slug, url }) {
    validateSlug(slug);
    validateUrl(url);
  },
  async run({ slug, url }, emit) {
    const env = gitEnv(slug);
    await runGit(['ls-remote', url, 'HEAD'], null, env, emit, 30_000);
    return { reachable: true };
  },
};

export const clone = {
  timeout: 300_000,
  validate({ slug, url }) {
    validateSlug(slug);
    validateUrl(url);
  },
  async run({ slug, url, branch = 'main' }, emit) {
    const dest = join(SITES_ROOT, slug, 'app');
    const env = gitEnv(slug);
    mkdirSync(dest, { recursive: true });
    await runGit(['clone', '--depth=50', '--branch', branch, url, dest], null, env, emit, 300_000);
    return { dest };
  },
};

export const pull = {
  timeout: 120_000,
  validate({ slug }) { validateSlug(slug); },
  async run({ slug, branch = 'main' }, emit) {
    const cwd = join(SITES_ROOT, slug, 'app');
    const env = gitEnv(slug);
    await runGit(['fetch', 'origin'], cwd, env, emit);
    await runGit(['reset', '--hard', `origin/${branch}`], cwd, env, emit);
    return { pulled: true };
  },
};

export const reset = {
  timeout: 60_000,
  validate({ slug, sha }) {
    validateSlug(slug);
    if (!sha || !/^[a-f0-9]{6,40}$/.test(sha)) throw new Error('Invalid commit SHA');
  },
  async run({ slug, sha }, emit) {
    const cwd = join(SITES_ROOT, slug, 'app');
    const env = gitEnv(slug);
    await runGit(['reset', '--hard', sha], cwd, env, emit);
    return { reset: sha };
  },
};

export const log = {
  validate({ slug }) { validateSlug(slug); },
  async run({ slug, n = 20 }) {
    const cwd = join(SITES_ROOT, slug, 'app');
    try {
      const out = execFileSync('git', ['log', `--max-count=${Math.min(n,100)}`, '--oneline', '--no-color'], { cwd, encoding: 'utf8' });
      return out.trim().split('\n').filter(Boolean).map((l) => {
        const [sha, ...msg] = l.split(' ');
        return { sha, message: msg.join(' ') };
      });
    } catch { return []; }
  },
};

export const currentCommit = {
  validate({ slug }) { validateSlug(slug); },
  async run({ slug }) {
    const cwd = join(SITES_ROOT, slug, 'app');
    try {
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
      const msg = execFileSync('git', ['log', '-1', '--format=%s'], { cwd, encoding: 'utf8' }).trim();
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
      return { sha, message: msg, branch };
    } catch { return { sha: null, message: null, branch: null }; }
  },
};
