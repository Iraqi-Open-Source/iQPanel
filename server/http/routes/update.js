import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';

const REPO    = process.env.PANEL_REPO    ?? 'Iraqi-Open-Source/iQPanel';
const REF     = process.env.PANEL_REF     ?? 'new';
const APP_DIR = process.env.PANEL_APP_DIR ?? '/opt/iqpanel';

export function registerUpdate(app) {
  // GET /api/update/check
  app.get('/api/update/check', requireAuth, rbac('admin'), async (req, res) => {
    try {
      const url    = `https://api.github.com/repos/${REPO}/releases/latest`;
      const resp   = await fetch(url, { headers: { 'User-Agent': 'iQPanel/1' } });
      if (!resp.ok) return res.json({ available: false, error: 'GitHub unreachable' });
      const data   = await resp.json();
      const latest = data.tag_name?.replace(/^v/, '');
      const current = JSON.parse(readFileSync(`${APP_DIR}/package.json`, 'utf8')).version;
      res.json({ available: latest !== current, current, latest, release_url: data.html_url });
    } catch (e) {
      res.status(503).json({ error: e.message });
    }
  });

  // POST /api/update/apply  – SSE stream of update output
  app.post('/api/update/apply', requireAuth, rbac('owner', { reauth: true }), (req, res) => {
    const sse = res.sse();

    const proc = spawn('/bin/bash', [`${APP_DIR}/installer/install.sh`], {
      env: {
        ...process.env,
        PANEL_SKIP_INTERACTIVE: '1',
      },
    });

    proc.stdout.on('data', (d) => sse.send('stdout', { line: d.toString() }));
    proc.stderr.on('data', (d) => sse.send('stderr', { line: d.toString() }));
    proc.on('close', (code) => {
      sse.send('done', { code });
      sse.close();
    });

    res.on('close', () => proc.kill());
  });
}
