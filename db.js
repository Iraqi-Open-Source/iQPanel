const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = process.env.PANEL_DATA_ROOT || path.join(__dirname, 'data');
const dbPath = path.join(root, 'panel.sqlite');
const schemaPath = path.join(__dirname, 'db', 'schema.sql');

fs.mkdirSync(root, { recursive: true });

function sql(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function run(statement, { foreignKeys = true } = {}) {
  const pragma = foreignKeys ? 'PRAGMA foreign_keys=ON;' : 'PRAGMA foreign_keys=OFF;';
  execFileSync('sqlite3', ['-batch', '-cmd', '.timeout 5000', '-cmd', pragma, dbPath, statement], { encoding: 'utf8' });
}

function rows(statement) {
  const output = execFileSync('sqlite3', ['-json', '-cmd', '.timeout 5000', '-cmd', 'PRAGMA foreign_keys=ON;', dbPath, statement], { encoding: 'utf8' }).trim();
  return output ? JSON.parse(output) : [];
}

function ensureColumn(table, column, definition) {
  const columns = rows(`PRAGMA table_info(${table})`).map((item) => item.name);
  if (!columns.includes(column)) run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function tableSql(name) {
  const row = rows(`SELECT sql FROM sqlite_master WHERE type='table' AND name=${sql(name)}`)[0];
  return row?.sql || '';
}

function recreateTable(name, createSql) {
  const columns = rows(`PRAGMA table_info(${name})`).map((item) => item.name);
  if (!columns.length) {
    run(createSql);
    return;
  }
  const tmp = `${name}__migrate`;
  run(`DROP TABLE IF EXISTS ${tmp}`, { foreignKeys: false });
  run(createSql.replace(`CREATE TABLE IF NOT EXISTS ${name}`, `CREATE TABLE ${tmp}`), { foreignKeys: false });
  const nextColumns = rows(`PRAGMA table_info(${tmp})`).map((item) => item.name);
  const shared = columns.filter((column) => nextColumns.includes(column));
  if (shared.length) {
    run(`INSERT INTO ${tmp} (${shared.join(',')}) SELECT ${shared.join(',')} FROM ${name}`, { foreignKeys: false });
  }
  run(`DROP TABLE ${name}`, { foreignKeys: false });
  run(`ALTER TABLE ${tmp} RENAME TO ${name}`, { foreignKeys: false });
}

run(fs.readFileSync(schemaPath, 'utf8'));

if (tableSql('sites') && !tableSql('sites').includes("'docker'")) {
  recreateTable('sites', `CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK(type IN ('php', 'node', 'python', 'static', 'docker')),
    repo_url TEXT,
    deploy_key_path TEXT,
    deploy_key_public TEXT,
    domain TEXT,
    port INTEGER,
    webserver TEXT NOT NULL DEFAULT 'nginx',
    ssl_status TEXT NOT NULL DEFAULT 'none',
    runtime_version TEXT,
    status TEXT NOT NULL DEFAULT 'online',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

if (tableSql('databases') && !tableSql('databases').includes("'postgres'")) {
  recreateTable('databases', `CREATE TABLE IF NOT EXISTS databases (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    engine TEXT NOT NULL CHECK(engine IN ('mysql', 'mariadb', 'postgres')),
    db_name TEXT NOT NULL UNIQUE,
    db_user TEXT NOT NULL,
    host TEXT NOT NULL DEFAULT 'localhost',
    created_at TEXT NOT NULL
  )`);
}

ensureColumn('databases', 'password_ciphertext', "TEXT NOT NULL DEFAULT ''");
ensureColumn('databases', 'granted', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('sites', 'backup_keep_count', 'INTEGER NOT NULL DEFAULT 5');
ensureColumn('sites', 'backup_keep_days', 'INTEGER NOT NULL DEFAULT 14');
ensureColumn('sites', 'app_port', 'INTEGER');
ensureColumn('sites', 'config_status', "TEXT NOT NULL DEFAULT 'pending'");
ensureColumn('sites', 'server_id', "TEXT NOT NULL DEFAULT 'local'");
ensureColumn('servers', 'last_probed_at', 'TEXT');
ensureColumn('sites', 'node_version', 'TEXT');
ensureColumn('sites', 'python_version', 'TEXT');
ensureColumn('sites', 'public_access', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('backups', 'details', "TEXT NOT NULL DEFAULT ''");
ensureColumn('sites', 'deploy_branch', "TEXT NOT NULL DEFAULT 'main'");
ensureColumn('sites', 'webhook_secret_ciphertext', "TEXT NOT NULL DEFAULT ''");
ensureColumn('sites', 'run_as_user', "TEXT NOT NULL DEFAULT ''");
ensureColumn('sites', 'directory', "TEXT NOT NULL DEFAULT ''");
ensureColumn('activity_log', 'user_id', 'TEXT');

run(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'operator', 'readonly')),
  password_hash TEXT NOT NULL,
  totp_secret_ciphertext TEXT NOT NULL DEFAULT '',
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  backup_codes_ciphertext TEXT NOT NULL DEFAULT '',
  failed_2fa INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL
)`);

run(`CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
)`);

function ensurePanelOwnership() {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  try {
    execFileSync('id', ['panel'], { stdio: 'ignore' });
  } catch {
    return;
  }
  const files = [dbPath, `${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    try {
      execFileSync('chown', ['panel:panel', file], { stdio: 'ignore' });
      fs.chmodSync(file, 0o660);
    } catch {}
  }
}

ensurePanelOwnership();

module.exports = { root, dbPath, sql, run, rows };
