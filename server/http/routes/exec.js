import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { get, run, query } from '../../data/db.js';
import { stream, invoke } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';
import { rbac, hasRole } from '../rbac.js';
import { auditLog } from '../../domain/audit.js';

function uuid()   { return randomBytes(16).toString('hex'); }
function nowIso() { return new Date().toISOString(); }

const DATA_ROOT = process.env.PANEL_DATA_ROOT ?? '/var/lib/iqpanel';
const SHORTCUT_ALLOWLIST = new Set([
  'php artisan migrate',
  'php artisan migrate:status',
  'php artisan migrate:fresh',
  'php artisan migrate:rollback',
  'php artisan optimize:clear',
  'php artisan config:cache',
  'php artisan config:clear',
  'php artisan route:cache',
  'php artisan route:clear',
  'php artisan view:cache',
  'php artisan view:clear',
  'php artisan cache:clear',
  'php artisan storage:link',
  'php artisan queue:restart',
  'php artisan queue:flush',
  'php artisan up',
  'php artisan down',
  'php artisan key:generate',
  'php artisan optimize',
  'composer install',
  'composer install --no-dev --optimize-autoloader --no-interaction',
  'composer update --no-dev --optimize-autoloader --no-interaction',
  'npm run build',
  'npm ci',
  'npm install',
]);

export function registerExec(app) {
  // POST /api/sites/:slug/exec  – arbitrary shell as site user (operator+ with reauth)
  app.post('/api/sites/:slug/exec', requireAuth, rbac('operator', { reauth: true }), (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const { cmd } = req.body ?? {};
    if (!cmd) return res.status(400).json({ error: 'cmd required' });

    const runId  = uuid();
    const logDir = join(DATA_ROOT, 'cmd-logs');
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `${runId}.log`);

    run('INSERT INTO command_runs (id,site_id,user_id,cmd,log_path,created_at) VALUES (?,?,?,?,?,?)',
      [runId, site.id, req.user.id, cmd, logPath, nowIso()]);
    auditLog(req, 'exec.run', site.slug, { cmd });

    const sse = res.sse();
    const { createWriteStream } = await import('node:fs');
    const logStream = createWriteStream(logPath, { flags: 'a' });

    stream('exec.run', { slug: site.slug, cmd }, (t, d) => {
      if (t === 'stdout' || t === 'stderr') {
        sse.send(t, { line: d });
        logStream.write(d);
      } else if (t === 'result') {
        logStream.end();
        run('UPDATE command_runs SET exit_code = ? WHERE id = ?', [d?.code ?? 0, runId]);
        sse.send('done', { code: d?.code });
        sse.close();
      } else if (t === 'error') {
        logStream.end();
        sse.send('error', { message: d });
        sse.close();
      }
    }).catch((e) => { sse.send('error', { message: e.message }); sse.close(); });
  });

  // POST /api/sites/:slug/shortcuts  – allowlisted artisan/composer shortcuts (readonly+)
  app.post('/api/sites/:slug/shortcut', requireAuth, rbac('readonly'), (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const { cmd } = req.body ?? {};
    const normalized = String(cmd ?? '').trim();

    if (!SHORTCUT_ALLOWLIST.has(normalized)) {
      return res.status(400).json({ error: 'Command not in allowlist', cmd: normalized });
    }

    // Destructive commands require operator + reauth
    const destructive = ['php artisan migrate:fresh', 'php artisan migrate:rollback'];
    if (destructive.includes(normalized)) {
      if (!rbacCheck(req, 'operator') || !req.reauthValid) {
        return res.status(403).json({ error: 'Re-authentication required for this command', code: 'reauth' });
      }
    }

    auditLog(req, 'exec.shortcut', site.slug, { cmd: normalized });
    const sse = res.sse();

    stream('exec.run', { slug: site.slug, cmd: normalized }, (t, d) => {
      if (t === 'stdout' || t === 'stderr') sse.send(t, { line: d });
      else if (t === 'result') { sse.send('done', { code: d?.code }); sse.close(); }
      else if (t === 'error')  { sse.send('error', { message: d }); sse.close(); }
    }).catch((e) => { sse.send('error', { message: e.message }); sse.close(); });
  });

  // GET /api/sites/:slug/env
  app.get('/api/sites/:slug/env', requireAuth, rbac('operator'), async (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    try {
      const result = await invoke('exec.env_read', { slug: site.slug });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/sites/:slug/env
  app.put('/api/sites/:slug/env', requireAuth, rbac('operator', { reauth: true }), async (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    try {
      await invoke('exec.env_write', { slug: site.slug, content: req.body?.content ?? '' });
      auditLog(req, 'exec.env_write', site.slug);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/sites/:slug/command-history
  app.get('/api/sites/:slug/command-history', requireAuth, (req, res) => {
    const site = get('SELECT id FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const rows = query('SELECT id,cmd,exit_code,created_at FROM command_runs WHERE site_id = ? ORDER BY created_at DESC LIMIT 50', [site.id]);
    res.json(rows);
  });
}

function rbacCheck(req, role) {
  return hasRole(req.user, role);
}
