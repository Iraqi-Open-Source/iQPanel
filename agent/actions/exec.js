import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SITES_ROOT, siteUserName, chownToSiteUser } from '../lib/site-user.js';

const MAX_OUTPUT = 1 * 1024 * 1024; // 1 MB

function validateSlug(slug) {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid slug');
}

function ensureSiteApp(slug) {
  const home = join(SITES_ROOT, slug);
  const app = join(home, 'app');
  mkdirSync(app, { recursive: true });
  try {
    chownToSiteUser(slug, home);
  } catch {}
  return { home, app, user: siteUserName(slug) };
}

/** Commands run with cwd already set to the site app directory. */
export function buildExecScript(cmd) {
  return cmd;
}

export const run = {
  timeout: 300_000,
  validate({ slug, cmd }) {
    validateSlug(slug);
    if (!cmd || typeof cmd !== 'string') throw new Error('cmd required');
    if (cmd.length > 4096) throw new Error('cmd too long');
  },
  async run({ slug, cmd, env: extraEnv = {} }, emit) {
    const { home, app, user } = ensureSiteApp(slug);

    const safeEnv = {
      HOME: home,
      USER: user,
      LOGNAME: user,
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      SHELL: '/bin/bash',
      COMPOSER_HOME: join(home, '.composer'),
      ...extraEnv,
    };

    const script = buildExecScript(cmd);

    return new Promise((resolve, reject) => {
      let totalOutput = 0;
      let truncated = false;

      const proc = spawn('runuser', [
        '-u', user, '--',
        '/bin/bash', '--noprofile', '--norc', '-c', script,
      ], {
        // Root opens app/; the site user inherits that cwd and must own it
        // so composer/artisan can write. Avoid `cd app` — with a 0750 home
        // owned by the wrong user, relative cd fails even when cwd is set.
        cwd: app,
        env: safeEnv,
      });

      const handleData = (stream) => (d) => {
        if (truncated) return;
        totalOutput += d.length;
        if (totalOutput > MAX_OUTPUT) {
          truncated = true;
          emit?.('stderr', '\n[output truncated at 1 MB]\n');
          proc.kill();
          return;
        }
        emit?.(stream, d.toString());
      };

      proc.stdout.on('data', handleData('stdout'));
      proc.stderr.on('data', handleData('stderr'));

      proc.on('close', (code) => {
        const exitCode = code ?? 1;
        emit?.('exit', null, { code: exitCode });
        resolve({ code: exitCode, truncated });
      });

      proc.on('error', reject);
    });
  },
};

export const envRead = {
  validate({ slug }) { validateSlug(slug); },
  async run({ slug }) {
    const path = join(SITES_ROOT, slug, 'app', '.env');
    if (!existsSync(path)) return { content: '', path };
    return { content: readFileSync(path, 'utf8'), path };
  },
};

export const envWrite = {
  validate({ slug, content }) {
    validateSlug(slug);
    if (content === undefined) throw new Error('content required');
    if (content.length > 256 * 1024) throw new Error('env too large');
  },
  async run({ slug, content }) {
    const path = join(SITES_ROOT, slug, 'app', '.env');
    writeFileSync(path, content, { mode: 0o640 });
    try { chownToSiteUser(slug, path); } catch {}
    return { path };
  },
};
