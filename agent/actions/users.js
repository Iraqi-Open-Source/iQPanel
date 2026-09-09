import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const SITES_ROOT = process.env.PANEL_SITES_ROOT ?? '/var/www/sites';

function siteUserName(slug) {
  const prefix = 'iqpanel-';
  if (prefix.length + slug.length <= 32) return `${prefix}${slug}`;
  const hash = createHash('sha1').update(slug).digest('hex').slice(0, 6);
  const keep = 32 - prefix.length - 1 - hash.length;
  return `${prefix}${slug.slice(0, keep)}-${hash}`;
}

function userExists(user) {
  return spawnSync('id', ['-u', user], { encoding: 'utf8' }).status === 0;
}

function validateSlug(slug) {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid slug');
}

export const createSiteUser = {
  validate({ slug }) { validateSlug(slug); },
  async run({ slug }) {
    const user = siteUserName(slug);
    const home = join(SITES_ROOT, slug);
    const appDir = join(home, 'app');
    const sshDir = join(home, '.ssh');

    mkdirSync(appDir, { recursive: true });
    mkdirSync(sshDir, { recursive: true, mode: 0o700 });

    if (!userExists(user)) {
      execFileSync('useradd', [
        '--system',
        '--home-dir', home,
        '--no-create-home',
        '--shell', '/bin/bash',
        '--comment', `iQPanel site ${slug}`,
        user,
      ], { encoding: 'utf8' });
    }

    try { execFileSync('usermod', ['-aG', user, 'www-data'], { encoding: 'utf8' }); } catch {}
    execFileSync('chown', ['-R', `${user}:${user}`, home], { encoding: 'utf8' });
    execFileSync('chmod', ['0750', home], { encoding: 'utf8' });

    return { user, home };
  },
};

export const removeSiteUser = {
  validate({ slug }) { validateSlug(slug); },
  async run({ slug }) {
    const user = siteUserName(slug);
    if (userExists(user)) {
      try { execFileSync('userdel', ['--force', user], { encoding: 'utf8' }); } catch {}
    }
    return { removed: user };
  },
};

export const listSshKeys = {
  async run() {
    const path = '/root/.ssh/authorized_keys';
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8').split('\n').filter(Boolean);
  },
};

export const addSshKey = {
  validate({ key }) {
    if (!key || typeof key !== 'string') throw new Error('key required');
    if (!key.startsWith('ssh-') && !key.startsWith('ecdsa-') && !key.startsWith('sk-')) throw new Error('Invalid SSH key format');
  },
  async run({ key }) {
    const path = '/root/.ssh/authorized_keys';
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (!existing.includes(key.trim())) {
      writeFileSync(path, existing.trimEnd() + '\n' + key.trim() + '\n', { mode: 0o600 });
    }
    return { added: true };
  },
};

export const removeSshKey = {
  validate({ key }) { if (!key) throw new Error('key required'); },
  async run({ key }) {
    const path = '/root/.ssh/authorized_keys';
    if (!existsSync(path)) return { removed: false };
    const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== key.trim());
    writeFileSync(path, lines.join('\n') + '\n', { mode: 0o600 });
    return { removed: true };
  },
};
