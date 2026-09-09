import { invoke } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';

export function registerServices(app) {
  app.get('/api/services', requireAuth, async (req, res) => {
    try {
      const list = await invoke('svc.list');
      res.json(list);
    } catch (e) {
      res.status(503).json({ error: e.message });
    }
  });

  for (const action of ['start','stop','restart','enable','disable']) {
    app.post(`/api/services/:unit/${action}`, requireAuth, rbac('operator'), async (req, res) => {
      try {
        const result = await invoke(`svc.${action}`, { unit: req.params.unit });
        res.json(result);
      } catch (e) {
        res.status(422).json({ error: e.message });
      }
    });
  }

  app.get('/api/services/:unit/status', requireAuth, async (req, res) => {
    try {
      const status = await invoke('svc.status', { unit: req.params.unit });
      res.json(status);
    } catch (e) {
      res.status(422).json({ error: e.message });
    }
  });

  app.get('/api/services/:unit/journal', requireAuth, async (req, res) => {
    try {
      const lines = Number(req.query.lines) || 200;
      const sse = res.sse();
      const result = await invoke('svc.journal', { unit: req.params.unit, lines });
      sse.send('log', { content: result.output ?? '' });
      sse.send('done', {});
      sse.close();
    } catch (e) {
      res.status(422).json({ error: e.message });
    }
  });
}
