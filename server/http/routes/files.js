import { invoke } from '../../agent-client.js';
import { get } from '../../data/db.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';

function getSite(slug) {
  return get('SELECT * FROM sites WHERE slug = ?', [slug]);
}

export function registerFiles(app) {
  app.get('/api/sites/:slug/files', requireAuth, async (req, res) => {
    const site = getSite(req.params.slug);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    try {
      const entries = await invoke('files.list', { slug: site.slug, path: req.query.path ?? '.' });
      res.json(entries);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/sites/:slug/files/read', requireAuth, async (req, res) => {
    const site = getSite(req.params.slug);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    try {
      const result = await invoke('files.read', { slug: site.slug, path: req.query.path });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/sites/:slug/files', requireAuth, rbac('operator'), async (req, res) => {
    const site = getSite(req.params.slug);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    try {
      const result = await invoke('files.write', { slug: site.slug, path: req.body.path, content: req.body.content });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/sites/:slug/files/mkdir', requireAuth, rbac('operator'), async (req, res) => {
    const site = getSite(req.params.slug);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    try {
      const result = await invoke('files.mkdir', { slug: site.slug, path: req.body.path });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/sites/:slug/files/rename', requireAuth, rbac('operator'), async (req, res) => {
    const site = getSite(req.params.slug);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    try {
      const result = await invoke('files.rename', { slug: site.slug, from: req.body.from, to: req.body.to });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/sites/:slug/files', requireAuth, rbac('operator'), async (req, res) => {
    const site = getSite(req.params.slug);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    try {
      const result = await invoke('files.delete', { slug: site.slug, path: req.body.path, recursive: req.body.recursive });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
}
