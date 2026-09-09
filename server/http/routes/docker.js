import { invoke, stream } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';

export function registerDocker(app) {
  app.get('/api/docker/status',     requireAuth, async (req, res) => res.json(await safeInvoke('docker.status', {})));
  app.get('/api/docker/containers', requireAuth, async (req, res) => res.json(await safeInvoke('docker.containers', { all: true })));
  app.get('/api/docker/images',     requireAuth, async (req, res) => res.json(await safeInvoke('docker.images', {})));

  app.post('/api/docker/containers/:id/:action', requireAuth, rbac('operator'), async (req, res) => {
    try {
      const result = await invoke('docker.container_action', { id: req.params.id, action: req.params.action });
      res.json(result);
    } catch (e) { res.status(422).json({ error: e.message }); }
  });

  app.get('/api/docker/containers/:id/logs', requireAuth, (req, res) => {
    const sse = res.sse();
    stream('docker.logs', { id: req.params.id, lines: 200 }, (t, d) => {
      if (t === 'stdout') sse.send('log', { line: d });
      else if (t === 'result') { sse.send('done', {}); sse.close(); }
    }).catch((e) => { sse.send('error', { message: e.message }); sse.close(); });
  });

  app.post('/api/docker/compose', requireAuth, rbac('operator'), (req, res) => {
    const { path, cmd, args = [] } = req.body ?? {};
    const sse = res.sse();
    stream('docker.compose', { path, cmd, args }, (t, d) => {
      if (t === 'stdout' || t === 'stderr') sse.send(t, { line: d });
      else if (t === 'result') { sse.send('done', { ok: true }); sse.close(); }
      else if (t === 'error')  { sse.send('error', { message: d }); sse.close(); }
    }).catch((e) => { sse.send('error', { message: e.message }); sse.close(); });
  });

  app.post('/api/docker/prune', requireAuth, rbac('admin'), async (req, res) => {
    try {
      const result = await invoke('docker.prune', { target: req.body?.target ?? 'system' });
      res.json(result);
    } catch (e) { res.status(422).json({ error: e.message }); }
  });
}

async function safeInvoke(action, args) {
  try { return await invoke(action, args); } catch { return {}; }
}
