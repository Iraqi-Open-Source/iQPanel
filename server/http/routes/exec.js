import { randomBytes } from 'node:crypto';
import { mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { get, run, query } from '../../data/db.js';
import { stream, invoke } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';
import { rbac, hasRole } from '../rbac.js';
import { auditLog } from '../../domain/audit.js';
import {
  SHORTCUT_ALLOWLIST, DESTRUCTIVE_COMMANDS, normalizeCmd, commandNeedsReauth,
} from '../command-policy.js';

function uuid()   { return randomBytes(16).toString('hex'); }
function nowIso() { return new Date().toISOString(); }

const DATA_ROOT = process.env.PANEL_DATA_ROOT ?? '/var/lib/iqpanel';

export function registerExec(app) {
  // POST /api/sites/:slug/exec  – shell as site user (operator; reauth for non-allowlisted)
  app.post('/api/sites/:slug/exec', requireAuth, rbac('operator'), (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const { cmd } = req.body ?? {};
    if (!cmd) return res.status(400).json({ error: 'cmd required' });
    if (commandNeedsReauth(cmd) && !req.reauthValid) {
      return res.status(403).json({ error: 'Re-authentication required', code: 'reauth' });
    }

    const runId  = uuid();
    const logDir = join(DATA_ROOT, 'cmd-logs');
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `${runId}.log`);

    run('INSERT INTO command_runs (id,site_id,user_id,cmd,log_path,created_at) VALUES (?,?,?,?,?,?)',
      [runId, site.id, req.user.id, cmd, logPath, nowIso()]);
    auditLog(req, 'exec.run', site.slug, { cmd });

    const sse = res.sse();
    const logStream = createWriteStream(logPath, { flags: 'a' });
    let closed = false;
    const finish = (event, payload) => {
      if (closed) return;
      closed = true;
      try { logStream.end(); } catch {}
      sse.send(event, payload);
      sse.close();
    };

    stream('exec.run', { slug: site.slug, cmd }, (t, d) => {
      if (t === 'stdout' || t === 'stderr') {
        const line = typeof d === 'string' ? d : String(d ?? '');
        sse.send(t, { line });
        logStream.write(line);
      } else if (t === 'result') {
        run('UPDATE command_runs SET exit_code = ? WHERE id = ?', [d?.code ?? 0, runId]);
        finish('done', { code: d?.code ?? 0 });
      } else if (t === 'error') {
        finish('error', { message: typeof d === 'string' ? d : (d?.message ?? 'Command failed') });
      }
    }).catch((e) => finish('error', { message: e.message }));
  });

  // POST /api/sites/:slug/shortcuts  – allowlisted artisan/composer shortcuts (readonly+)
  app.post('/api/sites/:slug/shortcut', requireAuth, rbac('readonly'), (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const { cmd } = req.body ?? {};
    const normalized = normalizeCmd(cmd);

    if (!SHORTCUT_ALLOWLIST.has(normalized)) {
      return res.status(400).json({ error: 'Command not in allowlist', cmd: normalized });
    }

    if (DESTRUCTIVE_COMMANDS.has(normalized)) {
      if (!rbacCheck(req, 'operator') || !req.reauthValid) {
        return res.status(403).json({ error: 'Re-authentication required for this command', code: 'reauth' });
      }
    }

    auditLog(req, 'exec.shortcut', site.slug, { cmd: normalized });
    const sse = res.sse();
    let closed = false;
    const finish = (event, payload) => {
      if (closed) return;
      closed = true;
      sse.send(event, payload);
      sse.close();
    };

    stream('exec.run', { slug: site.slug, cmd: normalized }, (t, d) => {
      if (t === 'stdout' || t === 'stderr') sse.send(t, { line: typeof d === 'string' ? d : String(d ?? '') });
      else if (t === 'result') finish('done', { code: d?.code ?? 0 });
      else if (t === 'error')  finish('error', { message: typeof d === 'string' ? d : (d?.message ?? 'Command failed') });
    }).catch((e) => finish('error', { message: e.message }));
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
