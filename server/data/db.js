/**
 * Data layer using node:sqlite (DatabaseSync, Node 24 RC-stable).
 * All queries use parameterised prepared statements – no string interpolation.
 * WAL mode + foreign keys enabled.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATA_ROOT = process.env.PANEL_DATA_ROOT ?? join(process.cwd(), 'data');
mkdirSync(DATA_ROOT, { recursive: true });

const DB_PATH  = join(DATA_ROOT, 'panel.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// Apply schema
const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Run pending migrations
applyMigrations();

const stmtCache = new Map();

function prepare(sql) {
  if (!stmtCache.has(sql)) stmtCache.set(sql, db.prepare(sql));
  return stmtCache.get(sql);
}

export function query(sql, params = []) {
  return prepare(sql).all(...params);
}

export function get(sql, params = []) {
  return prepare(sql).get(...params);
}

export function run(sql, params = []) {
  return prepare(sql).run(...params);
}

export function exec(sql) {
  return db.exec(sql);
}

/**
 * node:sqlite DatabaseSync has no better-sqlite3-style db.transaction().
 * Use an explicit BEGIN/COMMIT/ROLLBACK on this connection instead.
 */
export function transaction(fn) {
  if (typeof db.transaction === 'function') return db.transaction(fn)();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  }
}

export function close() {
  stmtCache.clear();
  db.close();
}

// ──────────────────────────────────────────────────
// Migrations
// ──────────────────────────────────────────────────

function applyMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const migDir = join(__dirname, 'migrations');
  if (!existsSync(migDir)) return;

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );

  const files = readdirMigrations(migDir);
  for (const { version, path } of files) {
    if (applied.has(version)) continue;
    const sql = readFileSync(path, 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
  }
}

function readdirMigrations(dir) {
  try {
    return readdirSync(dir)
      .filter((f) => /^\d{4}-.+\.sql$/.test(f))
      .sort()
      .map((f) => ({ version: parseInt(f.slice(0, 4), 10), path: join(dir, f) }));
  } catch { return []; }
}
