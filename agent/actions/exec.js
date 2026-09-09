import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const SITES_ROOT = process.env.PANEL_SITES_ROOT ?? '/var/www/sites';
const MAX_OUTPUT = 1 * 1024 * 1024; // 1 MB

function validateSlug(slug) {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid slug');
}

function siteUser(slug) {
  const prefix = 'iqpanel-';
  if (prefix.length + slug.length <= 32) return `${prefix}${slug}`;
  const hash = createHash('sha1').update(slug).digest('hex').slice(0, 6);
  const keep = 32 - prefix.length - 1 - hash.length;
  return `${prefix}${slug.slice(0, keep)}-${hash}`;
}

export const run = {
  timeout: 300_000,
  validate({ slug, cmd }) {
    validateSlug(slug);
    if (!cmd || typeof cmd !== 'string') throw new Error('cmd required');
    if (cmd.length > 4096) throw new Error('cmd too long');
  },
  async run({ slug, cmd, env: extraEnv = {} }, emit) {
    const cwd = join(SITES_ROOT, slug, 'app');
    const user = siteUser(slug);

    const safeEnv = {
      HOME: `/var/www/sites/${slug}`,
      USER: user,
      LOGNAME: user,
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/bin/composer',
      SHELL: '/bin/bash',
      ...extraEnv,
    };

    return new Promise((resolve, reject) => {
      let totalOutput = 0;
      let truncated = false;

      const proc = spawn('runuser', ['-u', user, '--', '/bin/bash', '-c', cmd], {
        cwd,
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
        emit?.('exit', null, { code });
        resolve({ code, truncated });
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
    return { path };
  },
};
