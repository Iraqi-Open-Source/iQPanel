import { stream, invoke } from '../../agent-client.js';
import { get, run } from '../../data/db.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';

function nowIso() { return new Date().toISOString(); }

export function registerSSL(app) {
  // POST /api/sites/:slug/ssl/issue
  app.post('/api/sites/:slug/ssl/issue', requireAuth, rbac('operator'), (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    if (!site.domain) return res.status(400).json({ error: 'No domain set on this site' });

    const { email } = req.body ?? {};
    if (!email) return res.status(400).json({ error: 'email required' });

    const sse = res.sse();
    stream('ssl.issue', { domain: site.domain, email, nginx: true }, (t, d) => {
      if (t === 'stdout' || t === 'stderr') sse.send(t, { line: d });
      else if (t === 'result') {
        run('UPDATE sites SET ssl_status = ?, updated_at = ? WHERE id = ?', ['active', nowIso(), site.id]);
        sse.send('done', { ok: true });
        sse.close();
      } else if (t === 'error') { sse.send('error', { message: d }); sse.close(); }
    }).catch((e) => { sse.send('error', { message: e.message }); sse.close(); });
  });

  // POST /api/sites/:slug/ssl/renew
  app.post('/api/sites/:slug/ssl/renew', requireAuth, rbac('operator'), (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const sse = res.sse();
    stream('ssl.renew', { domain: site.domain, force: req.body?.force }, (t, d) => {
      if (t === 'stdout') sse.send('stdout', { line: d });
      else if (t === 'result') { sse.send('done', { ok: true }); sse.close(); }
      else if (t === 'error')  { sse.send('error', { message: d }); sse.close(); }
    }).catch((e) => { sse.send('error', { message: e.message }); sse.close(); });
  });

  // GET /api/ssl/certificates
  app.get('/api/ssl/certificates', requireAuth, async (req, res) => {
    try { res.json(await invoke('ssl.list')); }
    catch (e) { res.status(503).json({ error: e.message }); }
  });
}
