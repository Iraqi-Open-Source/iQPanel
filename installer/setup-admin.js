#!/usr/bin/env node
/**
 * Bootstrap the first owner user in SQLite during installation.
 * Args: <hash> <salt>
 */
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const DATA_ROOT = process.env.PANEL_DATA_ROOT ?? '/var/lib/iqpanel';
mkdirSync(DATA_ROOT, { recursive: true });

const DB_PATH = join(DATA_ROOT, 'panel.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const schemaPath = new URL('../server/data/schema.sql', import.meta.url).pathname;
db.exec(readFileSync(schemaPath, 'utf8'));

const [hash, salt] = process.argv.slice(2);
if (!hash || !salt) {
  console.error('Usage: setup-admin.js <hash> <salt>');
  process.exit(1);
}

const existing = db.prepare('SELECT id FROM users WHERE role = ?').get('owner');
if (existing) {
  // Update existing owner password
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, existing.id);
  console.log('Admin password updated.');
} else {
  const id = randomBytes(16).toString('hex');
  db.prepare(
    'INSERT INTO users (id,email,name,role,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(id, 'admin@localhost', 'Admin', 'owner', hash, salt, new Date().toISOString());
  console.log('Admin user created.');
}

db.close();
