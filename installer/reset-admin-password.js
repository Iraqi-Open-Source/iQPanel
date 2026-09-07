const db = require('../db');
const users = require('../users');

const passwordHash = process.env.PANEL_ADMIN_PASSWORD_HASH;

if (!passwordHash) {
  throw new Error('PANEL_ADMIN_PASSWORD_HASH is required');
}

const existing = db.rows("SELECT id FROM users WHERE lower(email)='admin' LIMIT 1")[0]
  || db.rows("SELECT id FROM users WHERE role='owner' ORDER BY created_at ASC LIMIT 1")[0];

if (existing) {
  db.run(`UPDATE users SET password_hash=${db.sql(passwordHash)}, failed_2fa=0, locked_until=NULL WHERE id=${db.sql(existing.id)}`);
} else {
  users.ensureOwnerMigration();
}
