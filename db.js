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

function run(statement) {
  execFileSync('sqlite3', ['-batch', '-cmd', 'PRAGMA foreign_keys=ON;', dbPath, statement], { encoding: 'utf8' });
}

function rows(statement) {
  const output = execFileSync('sqlite3', ['-json', '-cmd', 'PRAGMA foreign_keys=ON;', dbPath, statement], { encoding: 'utf8' }).trim();
  return output ? JSON.parse(output) : [];
}

function ensureColumn(table, column, definition) {
  const columns = rows(`PRAGMA table_info(${table})`).map((item) => item.name);
  if (!columns.includes(column)) run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

run(fs.readFileSync(schemaPath, 'utf8'));
ensureColumn('databases', 'password_ciphertext', "TEXT NOT NULL DEFAULT ''");
ensureColumn('databases', 'granted', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('sites', 'backup_keep_count', 'INTEGER NOT NULL DEFAULT 5');
ensureColumn('sites', 'backup_keep_days', 'INTEGER NOT NULL DEFAULT 14');
ensureColumn('sites', 'app_port', 'INTEGER');
ensureColumn('sites', 'config_status', "TEXT NOT NULL DEFAULT 'pending'");

module.exports = { root, dbPath, sql, run, rows };
