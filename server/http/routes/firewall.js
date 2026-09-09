import { invoke } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';

export function registerFirewall(app) {
  app.get('/api/firewall/status',    requireAuth, async (req, res) => res.json(await safe('fw.status')));
  app.get('/api/firewall/listeners', requireAuth, async (req, res) => res.json(await safe('fw.listeners')));

  app.post('/api/firewall/allow', requireAuth, rbac('admin'), async (req, res) => {
    try { res.json(await invoke('fw.allow', req.body)); }
    catch (e) { res.status(422).json({ error: e.message }); }
  });
  app.post('/api/firewall/deny', requireAuth, rbac('admin'), async (req, res) => {
    try { res.json(await invoke('fw.deny', req.body)); }
    catch (e) { res.status(422).json({ error: e.message }); }
  });
  app.delete('/api/firewall/rule', requireAuth, rbac('admin'), async (req, res) => {
    try { res.json(await invoke('fw.delete', req.body)); }
    catch (e) { res.status(422).json({ error: e.message }); }
  });
}

async function safe(action, args = {}) {
  try { return await invoke(action, args); } catch { return {}; }
}
