import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const NGINX_ROOT = process.env.PANEL_NGINX_ROOT ?? '/etc/nginx';
const AVAIL = join(NGINX_ROOT, 'sites-available');
const ENABLED = join(NGINX_ROOT, 'sites-enabled');

function validateSlug(slug) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) throw new Error('Invalid slug');
}

export const test = {
  async run() {
    try {
      execFileSync('nginx', ['-t'], { encoding: 'utf8', stdio: 'pipe' });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.stderr?.toString() ?? e.message };
    }
  },
};

export const reload = {
  async run() {
    execFileSync('systemctl', ['reload', 'nginx'], { encoding: 'utf8' });
    return { reloaded: true };
  },
};

export const writeVhost = {
  validate({ slug, content }) {
    validateSlug(slug);
    if (!content || typeof content !== 'string') throw new Error('content required');
    if (content.length > 256 * 1024) throw new Error('vhost too large');
  },
  async run({ slug, content, enable = true }) {
    const avail = join(AVAIL, `${slug}.conf`);
    const enabled = join(ENABLED, `${slug}.conf`);

    // Save previous for rollback
    let prev = null;
    if (existsSync(avail)) prev = readFileSync(avail, 'utf8');

    writeFileSync(avail, content, { mode: 0o644 });

    if (enable) {
      try { unlinkSync(enabled); } catch {}
      symlinkSync(avail, enabled);
    }

    // Test
    try {
      execFileSync('nginx', ['-t'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      // Rollback
      if (prev !== null) writeFileSync(avail, prev, { mode: 0o644 });
      else unlinkSync(avail);
      try { unlinkSync(enabled); } catch {}
      throw new Error(`nginx -t failed: ${e.stderr?.toString() ?? e.message}`);
    }

    execFileSync('systemctl', ['reload', 'nginx'], { encoding: 'utf8' });
    return { slug, path: avail };
  },
};

export const removeVhost = {
  validate({ slug }) { validateSlug(slug); },
  async run({ slug }) {
    const avail = join(AVAIL, `${slug}.conf`);
    const enabled = join(ENABLED, `${slug}.conf`);
    try { rmSync(enabled); } catch {}
    try { rmSync(avail); } catch {}
    try { execFileSync('systemctl', ['reload', 'nginx'], { encoding: 'utf8' }); } catch {}
    return { removed: slug };
  },
};

export const readGlobal = {
  async run() {
    const path = join(NGINX_ROOT, 'nginx.conf');
    return { content: readFileSync(path, 'utf8'), path };
  },
};
