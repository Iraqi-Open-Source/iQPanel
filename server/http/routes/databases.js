import { randomBytes } from 'node:crypto';
import { query, get, run } from '../../data/db.js';
import { invoke, stream } from '../../agent-client.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';
import { encryptField, tryDecryptField } from '../../domain/secrets.js';
import { auditLog } from '../../domain/audit.js';
import { resolveCreateCredentials, assertOptionalDbPass, reasonFromEngineError } from '../../domain/databases.js';

function uuid()   { return randomBytes(16).toString('hex'); }
function nowIso() { return new Date().toISOString(); }

const ENGINE_PACKAGES = {
  mysql:    'mysql-server',
  mariadb:  'mariadb-server',
  postgres: 'postgresql',
  redis:    'redis-server',
};

const SQL_ENGINES = new Set(['mysql', 'mariadb', 'postgres']);
const HEALTH_ENGINES = new Set(['mysql', 'mariadb', 'postgres', 'redis']);

function engineFail(res, e) {
  const reason = e?.reason ?? reasonFromEngineError(e?.message);
  return res.status(500).json({ error: e.message, ...(reason ? { reason } : {}) });
}

const DB_LIST_SQL = `
  SELECT d.id, d.site_id, d.engine, d.db_name, d.db_user, d.granted, d.created_at,
         s.slug AS site_slug, s.name AS site_name, s.type AS site_type,
         s.domain AS site_domain, s.port AS site_port, s.status AS site_status,
         s.php_version AS site_php_version
  FROM databases d
  LEFT JOIN sites s ON s.id = d.site_id
`;

function mapDatabaseRow(row) {
  const {
    site_slug, site_name, site_type, site_domain, site_port, site_status, site_php_version,
    ...db
  } = row;
  return {
    ...db,
    site: db.site_id ? {
      slug: site_slug,
      name: site_name,
      type: site_type,
      domain: site_domain,
      port: site_port != null ? Number(site_port) : null,
      status: site_status,
      php_version: site_php_version,
    } : null,
  };
}

async function revealOrRotatePassword(db) {
  const got = tryDecryptField(db.db_pass_enc);
  if (got.ok && got.password) return { password: got.password, rotated: false };
  if (got.reason === 'no_password' || !db.db_user) {
    return { password: '', rotated: false, reason: 'no_password' };
  }
  const result = await invoke('db.set_password', {
    engine: db.engine, dbName: db.db_name, dbUser: db.db_user,
  });
  run('UPDATE databases SET db_pass_enc = ? WHERE id = ?', [encryptField(result.dbPass), db.id]);
  return { password: result.dbPass, rotated: true };
}

export function registerDatabases(app) {
  app.get('/api/databases/engines', requireAuth, async (req, res) => {
    try { res.json(await invoke('db.engines')); }
    catch (e) { res.status(503).json({ error: e.message }); }
  });

  app.get('/api/databases/engines/redis/password', requireAuth, rbac('operator'), async (req, res) => {
    try {
      const result = await invoke('redis.password');
      auditLog(req, 'redis.password', 'redis');
      res.json(result);
    } catch (e) {
      res.status(503).json({ error: e.message });
    }
  });

  app.post('/api/databases/engines/:engine/install', requireAuth, rbac('admin'), async (req, res) => {
    const pkg = ENGINE_PACKAGES[req.params.engine];
    if (!pkg) return res.status(400).json({ error: 'Unknown engine' });
    try {
      await stream('pkg.install', { name: pkg });
      res.json({ ok: true, package: pkg });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/databases/engines/:engine/health', requireAuth, async (req, res) => {
    const engine = req.params.engine;
    if (!HEALTH_ENGINES.has(engine)) {
      return res.status(400).json({ error: 'Unknown engine' });
    }
    try {
      const result = await invoke('db.engine_health', { engine });
      res.json(result);
    } catch (e) {
      res.status(503).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/databases/existing', requireAuth, async (req, res) => {
    const engine = String(req.query.engine ?? '');
    if (!SQL_ENGINES.has(engine)) {
      return res.status(400).json({ error: 'engine must be mysql, mariadb, or postgres' });
    }
    try {
      const names = await invoke('db.list', { engine });
      const tracked = new Set(query('SELECT db_name FROM databases WHERE engine = ?', [engine]).map((r) => r.db_name));
      res.json((Array.isArray(names) ? names : []).filter((n) => !tracked.has(n)));
    } catch (e) { engineFail(res, e); }
  });

  app.post('/api/databases/import', requireAuth, rbac('operator'), async (req, res) => {
    const { engine, db_name, db_user, db_pass, site_slug } = req.body ?? {};
    if (!SQL_ENGINES.has(engine)) {
      return res.status(400).json({ error: 'engine must be mysql, mariadb, or postgres' });
    }
    if (!db_name || !/^[a-z0-9_]{1,64}$/.test(db_name)) {
      return res.status(400).json({ error: 'Invalid db_name (a-z0-9_, 1-64 chars)' });
    }
    const user = db_user || db_name;
    if (!/^[a-z0-9_]{1,32}$/.test(user)) {
      return res.status(400).json({ error: 'Invalid db_user (a-z0-9_, 1-32 chars)' });
    }
    let passEnc = '';
    try {
      const pass = assertOptionalDbPass(db_pass);
      if (pass) passEnc = encryptField(pass);
    } catch (e) {
      return res.status(e.status ?? 400).json({ error: e.message });
    }
    if (get('SELECT id FROM databases WHERE db_name = ?', [db_name])) {
      return res.status(409).json({ error: 'Database is already tracked', reason: 'duplicate' });
    }
    let siteId = null;
    if (site_slug) {
      const site = get('SELECT id FROM sites WHERE slug = ?', [site_slug]);
      if (!site) return res.status(404).json({ error: 'Site not found' });
      siteId = site.id;
    }
    let names;
    try { names = await invoke('db.list', { engine }); }
    catch (e) { return engineFail(res, e); }
    if (!Array.isArray(names) || !names.includes(db_name)) {
      return res.status(404).json({ error: `Database ${db_name} does not exist on ${engine}` });
    }
    const id = uuid();
    run('INSERT INTO databases (id,site_id,engine,db_name,db_user,db_pass_enc,granted,created_at) VALUES (?,?,?,?,?,?,1,?)',
      [id, siteId, engine, db_name, user, passEnc, nowIso()]);
    res.status(201).json({ id, engine, db_name, db_user: user, imported: true, granted: true });
  });

  app.get('/api/databases', requireAuth, (req, res) => {
    const dbs = query(`${DB_LIST_SQL} ORDER BY d.created_at DESC`);
    res.json(dbs.map(mapDatabaseRow));
  });

  app.get('/api/sites/:slug/databases', requireAuth, (req, res) => {
    const site = get('SELECT id FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const dbs = query(`${DB_LIST_SQL} WHERE d.site_id = ? ORDER BY d.created_at DESC`, [site.id]);
    res.json(dbs.map(mapDatabaseRow));
  });

  app.get('/api/databases/:id/password', requireAuth, rbac('operator'), async (req, res) => {
    const db = get('SELECT * FROM databases WHERE id = ?', [req.params.id]);
    if (!db) return res.status(404).json({ error: 'Database not found' });
    try {
      const revealed = await revealOrRotatePassword(db);
      if (!revealed.password) return res.json({ configured: false, password: '', reason: revealed.reason ?? 'no_password' });
      auditLog(req, 'db.password', req.params.id, revealed.rotated ? { rotated: true } : {});
      res.json({ configured: true, password: revealed.password, rotated: revealed.rotated });
    } catch (e) {
      engineFail(res, e);
    }
  });

  app.post('/api/databases/:id/health', requireAuth, async (req, res) => {
    const db = get('SELECT * FROM databases WHERE id = ?', [req.params.id]);
    if (!db) return res.status(404).json({ error: 'Database not found' });
    try {
      const revealed = await revealOrRotatePassword(db);
      if (!revealed.password) {
        return res.json({ ok: false, reason: 'no_password', error: 'No stored password; import one to test this database.' });
      }
      const result = await invoke('db.health', {
        engine: db.engine, dbName: db.db_name, dbUser: db.db_user, dbPass: revealed.password,
      });
      res.json({ ...result, rotated: revealed.rotated });
    } catch (e) {
      res.status(503).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/databases', requireAuth, rbac('operator'), async (req, res) => {
    const { site_slug, engine, inject_env = false } = req.body ?? {};

    let siteId = null;
    let site = null;
    if (site_slug) {
      site = get('SELECT * FROM sites WHERE slug = ?', [site_slug]);
      if (!site) return res.status(404).json({ error: 'Site not found' });
      siteId = site.id;
    }

    if (!SQL_ENGINES.has(engine)) {
      return res.status(400).json({ error: 'engine must be mysql, mariadb, or postgres' });
    }

    let engines;
    try { engines = await invoke('db.engines'); } catch (e) {
      return res.status(503).json({ error: `Cannot reach agent: ${e.message}` });
    }
    const eng = engines[engine];
    if (!eng?.installed) return res.status(400).json({ error: `${engine} is not installed`, reason: 'not_installed' });
    if (!eng?.active)    return res.status(400).json({ error: `${engine} is not running`, reason: 'not_active' });

    let creds;
    try {
      creds = resolveCreateCredentials(req.body ?? {});
    } catch (e) {
      return res.status(e.status ?? 400).json({ error: e.message });
    }

    if (get('SELECT id FROM databases WHERE db_name = ?', [creds.dbName])) {
      return res.status(409).json({ error: 'Database is already tracked', reason: 'duplicate' });
    }

    const createArgs = { engine, dbName: creds.dbName, dbUser: creds.dbUser };
    if (creds.dbPass) createArgs.dbPass = creds.dbPass;

    let result;
    try {
      result = await invoke('db.create', createArgs);
    } catch (e) {
      return engineFail(res, e);
    }

    const id = uuid();
    run('INSERT INTO databases (id,site_id,engine,db_name,db_user,db_pass_enc,granted,created_at) VALUES (?,?,?,?,?,?,1,?)',
      [id, siteId, engine, creds.dbName, creds.dbUser, encryptField(result.dbPass), nowIso()]);

    let env_injected = false;
    let env_error;
    if (inject_env && site) {
      try {
        const envR = await invoke('exec.env_read', { slug: site.slug });
        let env = envR.content ?? '';
        const port = engine === 'postgres' ? 5432 : 3306;
        const driver = engine === 'postgres' ? 'pgsql' : 'mysql';
        env = setEnvVar(env, 'DB_CONNECTION', driver);
        env = setEnvVar(env, 'DB_HOST',       '127.0.0.1');
        env = setEnvVar(env, 'DB_PORT',        String(port));
        env = setEnvVar(env, 'DB_DATABASE',    creds.dbName);
        env = setEnvVar(env, 'DB_USERNAME',    creds.dbUser);
        env = setEnvVar(env, 'DB_PASSWORD',    result.dbPass);
        await invoke('exec.env_write', { slug: site.slug, content: env });
        await invoke('exec.run', { slug: site.slug, cmd: 'php artisan config:clear', php_version: site.php_version });
        env_injected = true;
      } catch (e) {
        env_error = e.message;
      }
    }

    res.status(201).json({
      id, engine, db_name: creds.dbName, db_user: creds.dbUser, db_pass: result.dbPass, granted: true,
      ...(inject_env && site ? { env_injected, ...(env_error ? { env_error } : {}) } : {}),
    });
  });

  app.delete('/api/databases/:id', requireAuth, rbac('admin', { reauth: true }), async (req, res) => {
    const db = get('SELECT * FROM databases WHERE id = ?', [req.params.id]);
    if (!db) return res.status(404).json({ error: 'Database not found' });

    try {
      await invoke('db.drop', { engine: db.engine, dbName: db.db_name, dbUser: db.db_user });
    } catch (e) {
      return engineFail(res, e);
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
