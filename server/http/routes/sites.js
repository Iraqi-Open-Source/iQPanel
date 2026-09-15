import { randomBytes } from 'node:crypto';
import { query, get, run, transaction } from '../../data/db.js';
import { invoke } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';
import { auditLog } from '../../domain/audit.js';
import { siteUserName } from '../../domain/sites.js';
import {
  applySiteAccess,
  assertPhpInstalled,
  persistAndApplySiteAccess,
  resolveSiteAccess,
} from '../../domain/site-access.js';

function uuid()   { return randomBytes(16).toString('hex'); }
function nowIso() { return new Date().toISOString(); }

function siteRow(site) {
  const dbs = query('SELECT * FROM databases WHERE site_id = ?', [site.id]);
  return { ...site, databases: dbs };
}

export function registerSites(app) {
  // GET /api/sites
  app.get('/api/sites', requireAuth, (req, res) => {
    const sites = query('SELECT * FROM sites ORDER BY created_at DESC');
    res.json(sites);
  });

  // GET /api/sites/:slug
  app.get('/api/sites/:slug', requireAuth, (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    res.json(siteRow(site));
  });

  // GET /api/sites/:slug/git  – live HEAD (used by overview when deploy SHA is missing)
  app.get('/api/sites/:slug/git', requireAuth, async (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    try {
      const info = await invoke('git.current_commit', { slug: site.slug });
      res.json(info ?? { sha: null });
    } catch (e) {
      res.json({ sha: null, message: null, branch: null, error: e.message });
    }
  });

  // POST /api/sites  – Create site (step 1-3 of wizard; step 4-5 via /api/sites/:slug/wizard)
  app.post('/api/sites', requireAuth, rbac('operator'), async (req, res) => {
    try {
      const {
        name, type = 'laravel', repo_url, domain, port,
        php_version = '8.3', webserver = 'nginx',
      } = req.body ?? {};

      if (!name) return res.status(400).json({ error: 'name required' });
      if (!['laravel','php','node','static','docker'].includes(type)) {
        return res.status(400).json({ error: 'Invalid type' });
      }

      if (type === 'laravel' || type === 'php') {
        await assertPhpInstalled(php_version);
      }

      const slug = slugify(name);
      const existing = get('SELECT id FROM sites WHERE slug = ?', [slug]);
      if (existing) return res.status(409).json({ error: 'Slug already exists', slug });

      let host, assignedPort;
      try {
        ({ domain: host, port: assignedPort } = await resolveSiteAccess({ domain, port }));
      } catch (e) {
        return res.status(e.status ?? 500).json({ error: e.message });
      }

      const id = uuid();
      const now = nowIso();

      transaction(() => {
        run(`INSERT INTO sites (id,name,slug,type,repo_url,domain,port,php_version,webserver,run_as_user,directory,status,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,'','','provisioning',?,?)`,
          [id, name, slug, type, repo_url ?? null, host, assignedPort ?? null, php_version, webserver, now, now]);
      });

      auditLog(req, 'site.create', slug);

      // Async provisioning
      provisionSite(id, slug, type, php_version, webserver, assignedPort, host, repo_url).catch((e) => {
        try { run('UPDATE sites SET status = ? WHERE id = ?', ['error', id]); } catch {}
        console.error('[provision] error', e?.message ?? e);
      });

      const site = get('SELECT * FROM sites WHERE id = ?', [id]);
      res.status(201).json(site);
    } catch (e) {
      console.error('[sites.create]', e);
      if (!res.headersSent) res.status(e.status ?? 500).json({ error: e.message ?? 'Failed to create site' });
    }
  });

  // GET /api/sites/:slug/wizard/deploy-key  – step 4: generate/return deploy key
  app.get('/api/sites/:slug/wizard/deploy-key', requireAuth, rbac('operator'), async (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    try {
      const result = await invoke('git.keygen', { slug: site.slug });
      run('UPDATE sites SET deploy_key_pub = ?, updated_at = ? WHERE id = ?',
        [result.publicKey, nowIso(), site.id]);
      const repoUrl = site.repo_url;
      const repoGuess = githubDeepLink(repoUrl, result.publicKey);
      res.json({ publicKey: result.publicKey, deployKeySettingsUrl: repoGuess });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/sites/:slug/wizard/test-connection  – step 4: verify deploy key works
  app.post('/api/sites/:slug/wizard/test-connection', requireAuth, rbac('operator'), async (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    if (!site.repo_url) return res.status(400).json({ error: 'No repo URL set' });
    try {
      await invoke('git.ls_remote', { slug: site.slug, url: site.repo_url });
      res.json({ reachable: true });
    } catch (e) {
      res.status(422).json({ reachable: false, error: e.message });
    }
  });

  // GET /api/sites/:slug/wizard/steps  – step 5: get deploy steps
  app.get('/api/sites/:slug/wizard/steps', requireAuth, (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const steps = query('SELECT * FROM site_deploy_steps WHERE site_id = ? ORDER BY position', [site.id]);
    res.json(steps);
  });

  // PUT /api/sites/:slug/wizard/steps  – step 5: save deploy steps
  app.put('/api/sites/:slug/wizard/steps', requireAuth, rbac('operator'), (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const { steps } = req.body ?? {};
    if (!Array.isArray(steps)) return res.status(400).json({ error: 'steps array required' });

    transaction(() => {
      run('DELETE FROM site_deploy_steps WHERE site_id = ?', [site.id]);
      for (let i = 0; i < steps.length; i++) {
        const { cmd, first_only = 0, enabled = 1 } = steps[i];
        if (!cmd) continue;
        run('INSERT INTO site_deploy_steps (id,site_id,position,cmd,first_only,enabled) VALUES (?,?,?,?,?,?)',
          [uuid(), site.id, i, cmd, first_only ? 1 : 0, enabled ? 1 : 0]);
      }
    });

    res.json({ ok: true });
  });

  // PATCH /api/sites/:slug  – update site config (re-provisions Nginx/PHP-FPM when access fields change)
  app.patch('/api/sites/:slug', requireAuth, rbac('operator'), async (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const body = req.body ?? {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return res.status(400).json({ error: 'name required' });
      if (name.length > 80) return res.status(400).json({ error: 'name too long' });
      body.name = name;
    }
    const simpleKeys = ['name', 'webserver', 'deploy_branch', 'status'];
    const accessTouched = body.domain !== undefined || body.port !== undefined || body.php_version !== undefined;
    const simpleTouched = simpleKeys.some((k) => body[k] !== undefined);
    if (!accessTouched && !simpleTouched) return res.status(400).json({ error: 'No fields to update' });

    try {
      let php_version = site.php_version;
      if (body.php_version !== undefined) {
        php_version = body.php_version;
        if (site.type === 'laravel' || site.type === 'php' || body.php_version !== site.php_version) {
          await assertPhpInstalled(php_version);
        }
      }

      let domain = site.domain;
      let port = site.port;
      if (body.domain !== undefined || body.port !== undefined) {
        ({ domain, port } = await resolveSiteAccess(body, {
          previous: site,
          excludeSiteId: site.id,
        }));
      }

      const next = { php_version, domain, port };
      for (const k of simpleKeys) {
        if (body[k] !== undefined) next[k] = body[k];
      }

      let updated;
      if (accessTouched) {
        updated = await persistAndApplySiteAccess(site, next);
      } else {
        const updates = [];
        const vals = [];
        for (const k of simpleKeys) {
          if (body[k] !== undefined) { updates.push(`${k} = ?`); vals.push(body[k]); }
        }
        vals.push(nowIso(), site.id);
        run(`UPDATE sites SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`, vals);
        updated = get('SELECT * FROM sites WHERE id = ?', [site.id]);
      }

      auditLog(req, 'site.update', site.slug);
      res.json(updated);
    } catch (e) {
      console.error('[sites.patch]', e);
      res.status(e.status ?? 500).json({ error: e.message ?? 'Failed to update site' });
    }
  });

  // DELETE /api/sites/:slug
  app.delete('/api/sites/:slug', requireAuth, rbac('admin', { reauth: true }), async (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const units = query('SELECT unit_name FROM systemd_units WHERE site_id = ?', [site.id]);
    for (const u of units) {
      try { await invoke('svc.remove_unit', { name: u.unit_name }); } catch {}
    }

    const oldPort = site.port != null ? Number(site.port) : null;
    if (oldPort && oldPort !== 80 && oldPort !== 443 && oldPort !== Number(process.env.PANEL_PORT)) {
      try { await invoke('fw.delete', { port: oldPort, proto: 'tcp' }); } catch {}
    }

    try { await invoke('nginx.remove_vhost',     { slug: site.slug }); } catch {}
    try { await invoke('php.remove_pool',        { slug: site.slug, version: site.php_version }); } catch {}
    try { await invoke('users.remove_site_user', { slug: site.slug }); } catch {}

    run('DELETE FROM sites WHERE id = ?', [site.id]);
    auditLog(req, 'site.delete', site.slug);
    res.json({ ok: true });
  });
}

// ──────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

function githubDeepLink(repoUrl, _key) {
  if (!repoUrl) return null;
  const m = repoUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (m) return `https://github.com/${m[1]}/settings/keys/new`;
  return null;
}

async function provisionSite(id, slug, type, phpVersion, webserver, port, domain, _repoUrl) {
  await invoke('users.create_site_user', { slug });

  const siteUser = siteUserName(slug);
  const directory = `/var/www/sites/${slug}`;
  run('UPDATE sites SET run_as_user = ?, directory = ? WHERE id = ?', [siteUser, directory, id]);

  const site = get('SELECT * FROM sites WHERE id = ?', [id]);
  await applySiteAccess(site, { php_version: phpVersion, webserver, port, domain });

  const keyResult = await invoke('git.keygen', { slug });
  run('UPDATE sites SET deploy_key_pub = ?, status = ?, updated_at = ? WHERE id = ?',
    [keyResult.publicKey, 'online', nowIso(), id]);
}
