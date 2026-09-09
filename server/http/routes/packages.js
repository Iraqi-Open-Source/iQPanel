import { stream } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';

export function registerPackages(app) {
  app.post('/api/packages/install', requireAuth, rbac('admin'), (req, res) => {
    const { name } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const sse = res.sse();
    stream('pkg.install', { name }, (t, d) => {
      if (t === 'stdout' || t === 'stderr') sse.send(t, { line: d });
      else if (t === 'result') { sse.send('done', { ok: true }); sse.close(); }
      else if (t === 'error')  { sse.send('error', { message: d }); sse.close(); }
    }).catch((e) => { sse.send('error', { message: e.message }); sse.close(); });
  });

  app.post('/api/packages/remove', requireAuth, rbac('admin', { reauth: true }), (req, res) => {
    const { name } = req.body ?? {};
    const sse = res.sse();
    stream('pkg.remove', { name }, (t, d) => {
      if (t === 'stdout') sse.send('stdout', { line: d });
      else if (t === 'result') { sse.send('done', { ok: true }); sse.close(); }
      else if (t === 'error')  { sse.send('error', { message: d }); sse.close(); }
    }).catch((e) => { sse.send('error', { message: e.message }); sse.close(); });
  });

  app.get('/api/packages/installed', requireAuth, async (req, res) => {
    const { invoke } = await import('../../agent-client.js');
    try { res.json(await invoke('pkg.list_installed')); }
    catch (e) { res.status(503).json({ error: e.message }); }
  });
}
