import { createReadStream, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { invoke } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';

const LOG_SOURCES = {
  nginx:   '/var/log/nginx',
  php:     '/var/log',
  panel:   process.env.PANEL_LOG_DIR ?? '/var/log/panel',
};

function resolveSafeLogPath(source, filename) {
  if (!filename) return null;
  const base = LOG_SOURCES[source] ?? LOG_SOURCES.panel;
  const abs  = join(base, filename.replace(/\.\./g, ''));
  if (!abs.startsWith(base)) return null;
  return abs;
}

export function registerLogs(app) {
  // GET /api/logs  – list available log sources
  app.get('/api/logs', requireAuth, (req, res) => {
    const result = {};
    for (const [src, dir] of Object.entries(LOG_SOURCES)) {
      try {
        result[src] = readdirSync(dir)
          .filter((f) => f.endsWith('.log'))
          .map((f) => ({ name: f, size: statSync(join(dir, f)).size }));
      } catch { result[src] = []; }
    }
    res.json(result);
  });

  // GET /api/logs/:source/:filename  – tail download
  app.get('/api/logs/:source/:filename', requireAuth, (req, res) => {
    const path = resolveSafeLogPath(req.params.source, req.params.filename);
    if (!path || !existsSync(path)) return res.status(404).json({ error: 'Log not found' });
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    createReadStream(path).pipe(res);
  });

  // GET /api/logs/:source/:filename/tail  – SSE live tail
  app.get('/api/logs/:source/:filename/tail', requireAuth, (req, res) => {
    const path = resolveSafeLogPath(req.params.source, req.params.filename);
    if (!path || !existsSync(path)) return res.status(404).json({ error: 'Log not found' });

    const sse = res.sse();
    let pos = statSync(path).size;

    let _openSync, _readSync, _closeSync;
    import('node:fs').then((m) => { _openSync = m.openSync; _readSync = m.readSync; _closeSync = m.closeSync; }).catch(() => {});

    const interval = setInterval(() => {
      if (!_openSync) return;
      try {
        const st = statSync(path);
        if (st.size === pos) return;
        if (st.size < pos) { pos = 0; }
        const fd  = _openSync(path, 'r');
        const buf = Buffer.alloc(Math.min(65536, st.size - pos));
        const n   = _readSync(fd, buf, 0, buf.length, pos);
        _closeSync(fd);
        if (n > 0) { pos += n; sse.send('log', { line: buf.slice(0, n).toString() }); }
      } catch {}
    }, 500);

    res.on('close', () => clearInterval(interval));
  });

  // GET /api/sites/:slug/logs  – per-site nginx/fpm logs
  app.get('/api/sites/:slug/logs', requireAuth, (req, res) => {
    const slug = req.params.slug;
    const sources = [
      { name: `${slug}-access.log`,     path: `/var/log/nginx/${slug}-access.log` },
      { name: `${slug}-error.log`,      path: `/var/log/nginx/${slug}-error.log` },
      { name: `${slug}-fpm-access.log`, path: `/var/log/nginx/${slug}-fpm-access.log` },
    ];
    res.json(sources.filter((s) => existsSync(s.path)).map((s) => ({ ...s, size: statSync(s.path).size })));
  });

  // Journald SSE for service units
  app.get('/api/journal/:unit', requireAuth, async (req, res) => {
    const sse = res.sse();
    try {
      const result = await invoke('svc.journal', { unit: req.params.unit, lines: req.query.lines ?? 200 });
      sse.send('log', { content: result?.output ?? '' });
    } catch (e) {
      sse.send('error', { message: e.message });
    }
    sse.send('done', {});
    sse.close();
  });
}
