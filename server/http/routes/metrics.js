import { invoke } from '../../agent-client.js';
import { query, run } from '../../data/db.js';
import { requireAuth } from '../middleware.js';

export function registerMetrics(app) {
  app.get('/api/metrics', requireAuth, async (req, res) => {
    try {
      const snap = await invoke('metrics.snapshot');
      // Store for sparklines
      try {
        run('INSERT INTO metrics_history (cpu_pct,mem_pct,disk_pct,load_1,ts) VALUES (?,?,?,?,?)',
          [snap.cpu, snap.mem?.percent, snap.disk?.percent, snap.load?.l1, Date.now()]);
        // Trim to last 1000 rows
        run('DELETE FROM metrics_history WHERE id NOT IN (SELECT id FROM metrics_history ORDER BY ts DESC LIMIT 1000)');
      } catch {}
      res.json(snap);
    } catch (e) {
      res.status(503).json({ error: e.message });
    }
  });

  app.get('/api/metrics/history', requireAuth, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 60, 1000);
    const rows  = query('SELECT * FROM metrics_history ORDER BY ts DESC LIMIT ?', [limit]).reverse();
    res.json(rows);
  });

  app.get('/api/metrics/disk', requireAuth, async (req, res) => {
    try { res.json(await invoke('metrics.disk')); }
    catch (e) { res.status(503).json({ error: e.message }); }
  });

  app.get('/api/metrics/processes', requireAuth, async (req, res) => {
    try { res.json(await invoke('metrics.processes', { limit: 25 })); }
    catch (e) { res.status(503).json({ error: e.message }); }
  });
}
