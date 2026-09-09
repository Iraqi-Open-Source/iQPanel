import { invoke, stream } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';

export function registerPHP(app) {
  // GET /api/php/versions
  app.get('/api/php/versions', requireAuth, async (req, res) => {
    try {
      const versions = await invoke('php.installed_versions');
      res.json(versions);
    } catch (e) {
      res.status(503).json({ error: e.message });
    }
  });

  // POST /api/php/install  (SSE streaming)
  app.post('/api/php/install', requireAuth, rbac('admin'), (req, res) => {
    const { version, extensions = [] } = req.body ?? {};
    const sse = res.sse();
    stream('php.install', { version, extensions }, (t, d) => {
      if (t === 'stdout' || t === 'stderr') sse.send(t, { line: d });
      else if (t === 'result') { sse.send('done', { ok: true }); sse.close(); }
      else if (t === 'error')  { sse.send('error', { message: d }); sse.close(); }
    }).catch((e) => { sse.send('error', { message: e.message }); sse.close(); });
  });

  // DELETE /api/php/:version
  app.delete('/api/php/:version', requireAuth, rbac('admin', { reauth: true }), (req, res) => {
    const sse = res.sse();
    stream('php.remove', { version: req.params.version }, (t, d) => {
      if (t === 'stdout') sse.send('stdout', { line: d });
      else if (t === 'result') { sse.send('done', { ok: true }); sse.close(); }
      else if (t === 'error')  { sse.send('error', { message: d }); sse.close(); }
    }).catch((e) => { sse.send('error', { message: e.message }); sse.close(); });
  });

  // POST /api/php/default
  app.post('/api/php/default', requireAuth, rbac('admin'), async (req, res) => {
    try {
      const result = await invoke('php.set_default', { version: req.body?.version });
      res.json(result);
    } catch (e) {
      res.status(422).json({ error: e.message });
    }
  });

  // GET /api/sites/:slug/php/ini
  app.get('/api/sites/:slug/php/ini', requireAuth, async (req, res) => {
    const site = await getSite(req.params.slug);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    try {
      const result = await invoke('php.read_ini', { version: site.php_version });
      res.json(result);
    } catch (e) {
      res.status(503).json({ error: e.message });
    }
  });
}

async function getSite(slug) {
  const { get } = await import('../../data/db.js');
  return get('SELECT * FROM sites WHERE slug = ?', [slug]);
}
