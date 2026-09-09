import { randomBytes } from 'node:crypto';
import { query, get, run, transaction } from '../../data/db.js';
import { invoke } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';
import { auditLog } from '../../domain/audit.js';
import { buildNginxVhost, buildPhpFpmPool, buildLaravelVhost } from '../../domain/provisioning.js';
import { allocatePort } from '../../domain/ports.js';
import { siteUserName } from '../../domain/sites.js';

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

      const slug = slugify(name);
      const existing = get('SELECT id FROM sites WHERE slug = ?', [slug]);
      if (existing) return res.status(409).json({ error: 'Slug already exists', slug });

      // Resolve port — empty string / 0 from the wizard counts as "auto"
      let assignedPort = port === '' || port === undefined ? null : port;
      if (assignedPort != null) assignedPort = Number(assignedPort);
      if (assignedPort != null && !Number.isInteger(assignedPort)) {
        return res.status(400).json({ error: 'Invalid port' });
      }
      const host = domain || null;
      if (!host && !assignedPort) {
        try { assignedPort = await allocatePort(); } catch (e) {
          return res.status(500).json({ error: `Port allocation failed: ${e.message}` });
        }
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
      if (!res.headersSent) res.status(500).json({ error: e.message ?? 'Failed to create site' });
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

  // PATCH /api/sites/:slug  – update site config
  app.patch('/api/sites/:slug', requireAuth, rbac('operator'), async (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const allowed = ['name','domain','port','php_version','webserver','deploy_branch','status'];
    const updates = [];
    const vals    = [];
    for (const k of allowed) {
      if (req.body?.[k] !== undefined) { updates.push(`${k} = ?`); vals.push(req.body[k]); }
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(nowIso(), site.id);
    run(`UPDATE sites SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`, vals);
    res.json(get('SELECT * FROM sites WHERE id = ?', [site.id]));
  });

  // DELETE /api/sites/:slug
  app.delete('/api/sites/:slug', requireAuth, rbac('admin', { reauth: true }), async (req, res) => {
    const site = get('SELECT * FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    // Best-effort cleanup
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

async function provisionSite(id, slug, type, phpVersion, webserver, port, domain, repoUrl) {
  // Create site user
  await invoke('users.create_site_user', { slug });

  const siteUser = siteUserName(slug);
  const directory = `/var/www/sites/${slug}`;

  run('UPDATE sites SET run_as_user = ?, directory = ? WHERE id = ?', [siteUser, directory, id]);

  if (webserver === 'nginx') {
    const vhostContent = type === 'laravel'
      ? buildLaravelVhost({ slug, domain, port, phpVersion, siteUser })
      : buildNginxVhost({ slug, type, domain, port, phpVersion, siteUser });

    await invoke('nginx.write_vhost', { slug, content: vhostContent });

    if (port && !domain) {
      try { await invoke('fw.allow', { port, proto: 'tcp' }); } catch (e) {
        console.error('[provision] ufw allow failed', e?.message ?? e);
      }
    }

    if (type === 'laravel' || type === 'php') {
      const poolContent = buildPhpFpmPool({ slug, phpVersion, siteUser, directory });
      await invoke('php.write_pool', { slug, version: phpVersion, content: poolContent });
    }
  }

  // Generate deploy key
  await invoke('git.keygen', { slug });
  const keyResult = await invoke('git.keygen', { slug });
  run('UPDATE sites SET deploy_key_pub = ?, status = ?, updated_at = ? WHERE id = ?',
    [keyResult.publicKey, 'online', nowIso(), id]);
}
