import { randomBytes } from 'node:crypto';
import { query, get, run } from '../../data/db.js';
import { invoke, stream } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';
import { encryptField } from '../../domain/secrets.js';

function uuid()   { return randomBytes(16).toString('hex'); }
function nowIso() { return new Date().toISOString(); }

const ENGINE_PACKAGES = {
  mysql:    'mysql-server',
  mariadb:  'mariadb-server',
  postgres: 'postgresql',
  redis:    'redis-server',
};

export function registerDatabases(app) {
  app.get('/api/databases/engines', requireAuth, async (req, res) => {
    try { res.json(await invoke('db.engines')); }
    catch (e) { res.status(503).json({ error: e.message }); }
  });

  app.post('/api/databases/engines/:engine/install', requireAuth, rbac('admin'), async (req, res) => {
    const pkg = ENGINE_PACKAGES[req.params.engine];
    if (!pkg) return res.status(400).json({ error: 'Unknown engine' });
    try {
      await stream('pkg.install', { name: pkg });
      res.json({ ok: true, package: pkg });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/databases/existing', requireAuth, async (req, res) => {
    const engine = String(req.query.engine ?? '');
    if (!['mysql', 'mariadb', 'postgres'].includes(engine)) {
      return res.status(400).json({ error: 'engine must be mysql, mariadb, or postgres' });
    }
    try {
      const names = await invoke('db.list', { engine });
      const tracked = new Set(query('SELECT db_name FROM databases WHERE engine = ?', [engine]).map((r) => r.db_name));
      res.json((Array.isArray(names) ? names : []).filter((n) => !tracked.has(n)));
    } catch (e) { res.status(503).json({ error: e.message }); }
  });

  app.post('/api/databases/import', requireAuth, rbac('operator'), async (req, res) => {
    const { engine, db_name, db_user, site_slug } = req.body ?? {};
    if (!['mysql', 'mariadb', 'postgres'].includes(engine)) {
      return res.status(400).json({ error: 'engine must be mysql, mariadb, or postgres' });
    }
    if (!db_name || !/^[a-z0-9_]{1,64}$/.test(db_name)) {
      return res.status(400).json({ error: 'Invalid db_name (a-z0-9_, 1-64 chars)' });
    }
    const user = db_user || db_name;
    if (!/^[a-z0-9_]{1,32}$/.test(user)) {
      return res.status(400).json({ error: 'Invalid db_user (a-z0-9_, 1-32 chars)' });
    }
    if (get('SELECT id FROM databases WHERE db_name = ?', [db_name])) {
      return res.status(409).json({ error: 'Database is already tracked' });
    }
    let siteId = null;
    if (site_slug) {
      const site = get('SELECT id FROM sites WHERE slug = ?', [site_slug]);
      if (!site) return res.status(404).json({ error: 'Site not found' });
      siteId = site.id;
    }
    let names;
    try { names = await invoke('db.list', { engine }); }
    catch (e) { return res.status(503).json({ error: e.message }); }
    if (!Array.isArray(names) || !names.includes(db_name)) {
      return res.status(404).json({ error: `Database ${db_name} does not exist on ${engine}` });
    }
    const id = uuid();
    run('INSERT INTO databases (id,site_id,engine,db_name,db_user,db_pass_enc,granted,created_at) VALUES (?,?,?,?,?,?,1,?)',
      [id, siteId, engine, db_name, user, '', nowIso()]);
    res.status(201).json({ id, engine, db_name, db_user: user, imported: true, granted: true });
  });

  // GET /api/databases
  app.get('/api/databases', requireAuth, (req, res) => {
    const dbs = query('SELECT id,site_id,engine,db_name,db_user,granted,created_at FROM databases ORDER BY created_at DESC');
    res.json(dbs);
  });

  // GET /api/sites/:slug/databases
  app.get('/api/sites/:slug/databases', requireAuth, (req, res) => {
    const site = get('SELECT id FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const dbs = query('SELECT id,engine,db_name,db_user,granted,created_at FROM databases WHERE site_id = ?', [site.id]);
    res.json(dbs);
  });

  // POST /api/databases
  app.post('/api/databases', requireAuth, rbac('operator'), async (req, res) => {
    const { site_slug, engine, db_name, db_user, inject_env = false } = req.body ?? {};

    let siteId = null;
    let site = null;
    if (site_slug) {
      site = get('SELECT * FROM sites WHERE slug = ?', [site_slug]);
      if (!site) return res.status(404).json({ error: 'Site not found' });
      siteId = site.id;
    }

    if (!['mysql','mariadb','postgres'].includes(engine)) {
      return res.status(400).json({ error: 'engine must be mysql, mariadb, or postgres' });
    }

    // Check engine is available
    let engines;
    try { engines = await invoke('db.engines'); } catch (e) {
      return res.status(503).json({ error: `Cannot reach agent: ${e.message}` });
    }
    const eng = engines[engine];
    if (!eng?.installed) return res.status(400).json({ error: `${engine} is not installed`, reason: 'not_installed' });
    if (!eng?.active)    return res.status(400).json({ error: `${engine} is not running`, reason: 'not_active' });

    if (!db_name || !/^[a-z0-9_]{1,64}$/.test(db_name)) {
      return res.status(400).json({ error: 'Invalid db_name (a-z0-9_, 1-64 chars)' });
    }
    if (!db_user || !/^[a-z0-9_]{1,32}$/.test(db_user)) {
      return res.status(400).json({ error: 'Invalid db_user (a-z0-9_, 1-32 chars)' });
    }

    let result;
    try {
      result = await invoke('db.create', { engine, dbName: db_name, dbUser: db_user });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }

    const id = uuid();
    run('INSERT INTO databases (id,site_id,engine,db_name,db_user,db_pass_enc,granted,created_at) VALUES (?,?,?,?,?,?,1,?)',
      [id, siteId, engine, db_name, db_user, encryptField(result.dbPass), nowIso()]);

    // Optionally inject .env
    if (inject_env && site) {
      try {
        const envR = await invoke('exec.env_read', { slug: site.slug });
        let env = envR.content ?? '';
        const port = engine === 'postgres' ? 5432 : 3306;
        const driver = engine === 'postgres' ? 'pgsql' : 'mysql';
        env = setEnvVar(env, 'DB_CONNECTION', driver);
        env = setEnvVar(env, 'DB_HOST',       '127.0.0.1');
        env = setEnvVar(env, 'DB_PORT',        String(port));
        env = setEnvVar(env, 'DB_DATABASE',    db_name);
        env = setEnvVar(env, 'DB_USERNAME',    db_user);
        env = setEnvVar(env, 'DB_PASSWORD',    result.dbPass);
        await invoke('exec.env_write', { slug: site.slug, content: env });
        await invoke('exec.run', { slug: site.slug, cmd: 'php artisan config:clear' });
      } catch {}
    }

    res.status(201).json({ id, engine, db_name, db_user, db_pass: result.dbPass, granted: true });
  });

  // DELETE /api/databases/:id
  app.delete('/api/databases/:id', requireAuth, rbac('admin', { reauth: true }), async (req, res) => {
    const db = get('SELECT * FROM databases WHERE id = ?', [req.params.id]);
    if (!db) return res.status(404).json({ error: 'Database not found' });

    try {
      await invoke('db.drop', { engine: db.engine, dbName: db.db_name, dbUser: db.db_user });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }

    run('DELETE FROM databases WHERE id = ?', [db.id]);
    res.json({ ok: true });
  });
}

function setEnvVar(env, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  return re.test(env) ? env.replace(re, line) : env.trimEnd() + '\n' + line + '\n';
}
