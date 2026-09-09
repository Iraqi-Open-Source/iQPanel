/**
 * Minimal HTTP router without npm dependencies.
 * Provides express-like req/res with routing, body parsing, cookie handling,
 * static files, and SSE helpers.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
};

export class Router {
  constructor() {
    this._routes = { GET: [], POST: [], PUT: [], PATCH: [], DELETE: [] };
    this._middleware = [];
    this._staticDir = null;
  }

  use(fn) { this._middleware.push(fn); return this; }

  get(path, ...fns)    { this._add('GET',    path, fns); return this; }
  post(path, ...fns)   { this._add('POST',   path, fns); return this; }
  put(path, ...fns)    { this._add('PUT',    path, fns); return this; }
  patch(path, ...fns)  { this._add('PATCH',  path, fns); return this; }
  delete(path, ...fns) { this._add('DELETE', path, fns); return this; }

  static(dir) { this._staticDir = dir; return this; }

  _add(method, path, fns) {
    const pattern = buildPattern(path);
    this._routes[method].push({ pattern, fns });
  }

  _dispatch(req, res) {
    const url  = new URL(req.url, 'http://x');
    const path = decodeURIComponent(url.pathname);
    const method = req.method.toUpperCase();

    // Static files
    if ((method === 'GET' || method === 'HEAD') && this._staticDir) {
      const file = serveStatic(this._staticDir, path, req, res);
      if (file) return;
    }

    const routes = this._routes[method] ?? [];
    for (const { pattern, fns } of routes) {
      const params = match(pattern, path);
      if (params === null) continue;

      req.params = params;
      req.query  = Object.fromEntries(url.searchParams);

      const chain = [...this._middleware, ...fns];
      let i = 0;
      const next = (err) => {
        if (err) { res.status(500).json({ error: err.message ?? String(err) }); return; }
        const fn = chain[i++];
        if (!fn) { res.status(404).json({ error: 'Not found' }); return; }
        try { fn(req, res, next); } catch (e) { next(e); }
      };
      next();
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  listen(port, host, cb) {
    const server = createServer((req, res) => {
      enhanceReq(req);
      enhanceRes(res);
      readBody(req).then(() => this._dispatch(req, res)).catch((e) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      });
    });
    server.listen(port, host, cb);
    return server;
  }
}

// ──────────────────────────────────────────────────
// Pattern matching  /sites/:slug -> { slug }
// ──────────────────────────────────────────────────

function buildPattern(route) {
  const parts = route.split('/').filter(Boolean);
  const keys  = [];
  const regex = parts.map((p) => {
    if (p.startsWith(':')) { keys.push(p.slice(1)); return '([^/]+)'; }
    if (p === '*')         { keys.push('wildcard'); return '(.*)'; }
    return p.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }).join('\\/');
  return { re: new RegExp(`^\\/${regex}\\/?$`), keys };
}

function match({ re, keys }, path) {
  const m = re.exec(path);
  if (!m) return null;
  const params = {};
  keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
  return params;
}

// ──────────────────────────────────────────────────
// Request enhancement
// ──────────────────────────────────────────────────

function enhanceReq(req) {
  req.cookies = parseCookies(req.headers.cookie ?? '');
  req.body    = undefined;
  req.params  = {};
  req.query   = {};
}

function parseCookies(str) {
  const out = {};
  for (const pair of str.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

async function readBody(req) {
  const ct = req.headers['content-type'] ?? '';
  if (!['POST','PUT','PATCH'].includes(req.method)) return;
  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  if (ct.includes('application/json')) {
    try { req.body = JSON.parse(raw); } catch { throw new Error('Invalid JSON body'); }
  } else if (ct.includes('multipart/form-data')) {
    req.rawBody = raw;
  } else {
    req.rawBody = raw;
  }
}

// ──────────────────────────────────────────────────
// Response enhancement
// ──────────────────────────────────────────────────

function enhanceRes(res) {
  res._status = 200;
  res.status = function(code) { this._status = code; return this; };
  res.json = function(data) {
    this.writeHead(this._status, { 'Content-Type': 'application/json; charset=utf-8' });
    this.end(JSON.stringify(data));
  };
  res.setCookie = function(name, value, opts = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    if (opts.httpOnly !== false) parts.push('HttpOnly');
    if (opts.sameSite ?? true) parts.push(`SameSite=${opts.sameSite ?? 'Strict'}`);
    if (opts.secure)  parts.push('Secure');
    if (opts.maxAge)  parts.push(`Max-Age=${opts.maxAge}`);
    if (opts.path ?? true) parts.push(`Path=${opts.path ?? '/'}`);
    const existing = this.getHeader('Set-Cookie') ?? [];
    this.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), parts.join('; ')]);
  };
  res.clearCookie = function(name) {
    this.setCookie(name, '', { maxAge: 0 });
  };
  res.sse = function() {
    this.writeHead(200, {
      'Content-Type':  'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    return {
      send(event, data) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
      raw(text) { res.write(text); },
      close()   { res.end(); },
    };
  };
}

// ──────────────────────────────────────────────────
// Static file serving
// ──────────────────────────────────────────────────

function serveStatic(dir, urlPath, req, res) {
  if (urlPath === '/api' || urlPath.startsWith('/api/')) return false;

  let rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  let abs = join(dir, rel);

  // SPA fallback
  if (!existsSync(abs) || (existsSync(abs) && statSync(abs).isDirectory())) {
    abs = join(dir, 'index.html');
    if (!existsSync(abs)) return false;
  }

  const ext  = extname(abs);
  const mime = MIME[ext] ?? 'application/octet-stream';
  const stat = statSync(abs);
  const etag = `"${stat.mtime.getTime().toString(16)}-${stat.size.toString(16)}"`;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    res.end();
    return true;
  }

  res.writeHead(200, {
    'Content-Type':  mime,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
    'ETag':          etag,
  });
  if (req.method === 'HEAD') { res.end(); return true; }
  res.end(readFileSync(abs));
  return true;
}
