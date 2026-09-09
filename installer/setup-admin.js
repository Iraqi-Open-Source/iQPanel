#!/usr/bin/env node
/**
 * Bootstrap the first owner user in SQLite during installation.
 * Args: <hash> <salt>
 */
import { randomBytes } from 'node:crypto';

process.env.PANEL_DATA_ROOT ??= '/var/lib/iqpanel';

const { get, run, close } = await import('../server/data/db.js');

const [hash, salt] = process.argv.slice(2);
if (!hash || !salt) {
  console.error('Usage: setup-admin.js <hash> <salt>');
  process.exit(1);
}

const existing = get('SELECT id FROM users WHERE role = ?', ['owner']);
if (existing) {
  run('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?', [hash, salt, existing.id]);
  console.log('Admin password updated.');
} else {
  const id = randomBytes(16).toString('hex');
  run(
    'INSERT INTO users (id,email,name,role,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?,?)',
    [id, 'admin@localhost', 'Admin', 'owner', hash, salt, new Date().toISOString()]
  );
  console.log('Admin user created.');
}

close();
