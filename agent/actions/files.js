import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, rmSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const SITE_ROOT = process.env.PANEL_SITES_ROOT ?? '/var/www/sites';
const MAX_READ = 2 * 1024 * 1024; // 2 MB

function safePath(slug, rel) {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error('Invalid slug');
  const base = join(SITE_ROOT, slug, 'app');
  const abs = resolve(base, rel ?? '');
  if (!abs.startsWith(base)) throw new Error('Path traversal denied');
  return abs;
}

export const list = {
  validate({ slug }) { if (!slug) throw new Error('slug required'); },
  async run({ slug, path = '.' }) {
    const abs = safePath(slug, path);
    mkdirSync(abs, { recursive: true });
    const entries = readdirSync(abs, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
      size: e.isFile() ? statSync(join(abs, e.name)).size : 0,
      mtime: statSync(join(abs, e.name)).mtime.toISOString(),
    }));
  },
};

export const read = {
  validate({ slug, path }) {
    if (!slug) throw new Error('slug required');
    if (!path) throw new Error('path required');
  },
  async run({ slug, path }) {
    const abs = safePath(slug, path);
    const st = statSync(abs);
    if (st.size > MAX_READ) throw new Error('File too large to read via API');
    return { content: readFileSync(abs, 'utf8'), path };
  },
};

export const write = {
  validate({ slug, path, content }) {
    if (!slug) throw new Error('slug required');
    if (!path) throw new Error('path required');
    if (content === undefined || content === null) throw new Error('content required');
    if (String(content).length > MAX_READ) throw new Error('Content too large');
  },
  async run({ slug, path, content }) {
    const abs = safePath(slug, path);
    mkdirSync(resolve(abs, '..'), { recursive: true });
    writeFileSync(abs, content, { encoding: 'utf8', mode: 0o644 });
    return { path };
  },
};

export const mkdir = {
  validate({ slug, path }) {
    if (!slug) throw new Error('slug required');
    if (!path) throw new Error('path required');
  },
  async run({ slug, path }) {
    const abs = safePath(slug, path);
    mkdirSync(abs, { recursive: true, mode: 0o755 });
    return { path };
  },
};

export const rename = {
  validate({ slug, from, to }) {
    if (!slug || !from || !to) throw new Error('slug, from, to required');
  },
  async run({ slug, from, to }) {
    const src = safePath(slug, from);
    const dst = safePath(slug, to);
    renameSync(src, dst);
    return { from, to };
  },
};

export const deleteFile = {
  validate({ slug, path }) {
    if (!slug || !path) throw new Error('slug and path required');
  },
  async run({ slug, path, recursive = false }) {
    const abs = safePath(slug, path);
    if (recursive) rmSync(abs, { recursive: true, force: true });
    else unlinkSync(abs);
    return { deleted: path };
  },
};

export const stat = {
  validate({ slug, path }) {
    if (!slug || !path) throw new Error('slug and path required');
  },
  async run({ slug, path }) {
    const abs = safePath(slug, path);
    const st = statSync(abs);
    return {
      size: st.size,
      isDir: st.isDirectory(),
      mtime: st.mtime.toISOString(),
      ctime: st.ctime.toISOString(),
      mode: st.mode.toString(8),
    };
  },
};
