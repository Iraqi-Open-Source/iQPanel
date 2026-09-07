const crypto = require('node:crypto');
const db = require('./db');
const secrets = require('./secrets');

const ROLES = ['owner', 'admin', 'operator', 'readonly'];

function now() {
  return new Date().toISOString();
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    totp_enabled: row.totp_enabled !== 0 && row.totp_enabled !== '0',
    locked_until: row.locked_until || null,
    created_at: row.created_at,
  };
}

function getUser(id) {
  return db.rows(`SELECT * FROM users WHERE id=${db.sql(id)} LIMIT 1`)[0] || null;
}

function findUserByEmail(email) {
  return db.rows(`SELECT * FROM users WHERE lower(email)=${db.sql(String(email || '').toLowerCase())} LIMIT 1`)[0] || null;
}

function listUsers() {
  return db.rows('SELECT * FROM users ORDER BY created_at ASC').map(publicUser);
}

function ownerCount() {
  return Number(db.rows(`SELECT COUNT(*) AS c FROM users WHERE role='owner'`)[0]?.c || 0);
}

function ensureOwnerMigration() {
  const hash = process.env.PANEL_ADMIN_PASSWORD_HASH;
  if (!hash) return null;
  const existing = db.rows('SELECT id FROM users LIMIT 1')[0];
  if (existing) return existing;
  const created = now();
  const user = {
    id: crypto.randomUUID(),
    email: 'admin',
    name: 'Owner',
    role: 'owner',
    password_hash: hash,
    created_at: created,
  };
  db.run(`INSERT INTO users (id,email,name,role,password_hash,created_at) VALUES (${db.sql(user.id)},${db.sql(user.email)},${db.sql(user.name)},'owner',${db.sql(user.password_hash)},${db.sql(created)})`);
  return user;
}

function assertRole(role) {
  if (!ROLES.includes(role)) throw Object.assign(new Error('Invalid role'), { statusCode: 400 });
  return role;
}

function createUser({ email, name, role, password }, actor) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[a-z0-9._@+-]{2,80}$/i.test(normalized)) throw Object.assign(new Error('Invalid email'), { statusCode: 400 });
  if (findUserByEmail(normalized)) throw Object.assign(new Error('A user with this email already exists'), { statusCode: 400 });
  const nextRole = assertRole(role || 'operator');
  if (nextRole === 'owner' && actor?.role !== 'owner') throw Object.assign(new Error('Only an owner can create owners'), { statusCode: 403 });
  const secret = String(password || '').trim() || secrets.password();
  if (secret.length < 8) throw Object.assign(new Error('Password must be at least 8 characters'), { statusCode: 400 });
  const created = now();
  const user = {
    id: crypto.randomUUID(),
    email: normalized,
    name: String(name || normalized).trim() || normalized,
    role: nextRole,
    password_hash: secrets.hashPassword(secret),
    created_at: created,
  };
  db.run(`INSERT INTO users (id,email,name,role,password_hash,created_at) VALUES (${db.sql(user.id)},${db.sql(user.email)},${db.sql(user.name)},${db.sql(user.role)},${db.sql(user.password_hash)},${db.sql(created)})`);
  return { ...publicUser(user), password: secret };
}

function updateUser(id, input, actor) {
  const user = getUser(id);
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
  if (user.role === 'owner' && actor?.role !== 'owner' && actor?.id !== user.id) {
    throw Object.assign(new Error('Only an owner can modify owners'), { statusCode: 403 });
  }
  let role = user.role;
  if (input.role) {
    role = assertRole(input.role);
    if (user.role === 'owner' && role !== 'owner' && ownerCount() <= 1) {
      throw Object.assign(new Error('Cannot demote the last owner'), { statusCode: 400 });
    }
    if (role === 'owner' && actor?.role !== 'owner') throw Object.assign(new Error('Only an owner can grant owner'), { statusCode: 403 });
  }
  const name = input.name !== undefined ? String(input.name).trim() : user.name;
  let passwordHash = user.password_hash;
  if (input.password) {
    if (String(input.password).length < 8) throw Object.assign(new Error('Password must be at least 8 characters'), { statusCode: 400 });
    passwordHash = secrets.hashPassword(input.password);
  }
  db.run(`UPDATE users SET name=${db.sql(name)}, role=${db.sql(role)}, password_hash=${db.sql(passwordHash)} WHERE id=${db.sql(id)}`);
  return publicUser(getUser(id));
}

function deleteUser(id, actor) {
  const user = getUser(id);
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
  if (user.role === 'owner' && ownerCount() <= 1) throw Object.assign(new Error('Cannot delete the last owner'), { statusCode: 400 });
  if (user.role === 'owner' && actor?.role !== 'owner') throw Object.assign(new Error('Only an owner can delete owners'), { statusCode: 403 });
  db.run(`DELETE FROM users WHERE id=${db.sql(id)}`);
  return { removed: true };
}

function setTotp(id, { secret, enabled, backupCodes }) {
  const user = getUser(id);
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
  const totpCipher = secret === undefined
    ? user.totp_secret_ciphertext
    : (secret ? secrets.encrypt(secret) : '');
  let codesCipher = user.backup_codes_ciphertext;
  if (backupCodes !== undefined && backupCodes !== null) {
    codesCipher = backupCodes.length
      ? secrets.encrypt(JSON.stringify(backupCodes.map((code) => secrets.hashPassword(code))))
      : '';
  }
  db.run(`UPDATE users SET totp_secret_ciphertext=${db.sql(totpCipher)}, totp_enabled=${enabled ? 1 : 0}, backup_codes_ciphertext=${db.sql(codesCipher)}, failed_2fa=0, locked_until=NULL WHERE id=${db.sql(id)}`);
}

function totpSecret(user) {
  if (!user?.totp_secret_ciphertext) return '';
  return secrets.decrypt(user.totp_secret_ciphertext);
}

function backupHashes(user) {
  if (!user?.backup_codes_ciphertext) return [];
  try {
    return JSON.parse(secrets.decrypt(user.backup_codes_ciphertext));
  } catch {
    return [];
  }
}

function consumeBackupCode(user, code) {
  const hashes = backupHashes(user);
  const match = hashes.find((hash) => secrets.verifyPassword(code, hash));
  if (!match) return false;
  const remaining = hashes.filter((hash) => hash !== match);
  db.run(`UPDATE users SET backup_codes_ciphertext=${db.sql(secrets.encrypt(JSON.stringify(remaining)))} WHERE id=${db.sql(user.id)}`);
  return true;
}

function record2faFailure(user) {
  const failed = Number(user.failed_2fa || 0) + 1;
  const locked = failed >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
  db.run(`UPDATE users SET failed_2fa=${failed}, locked_until=${db.sql(locked)} WHERE id=${db.sql(user.id)}`);
  return { failed, locked };
}

function clear2faFailures(user) {
  db.run(`UPDATE users SET failed_2fa=0, locked_until=NULL WHERE id=${db.sql(user.id)}`);
}

function isLocked(user) {
  return Boolean(user?.locked_until && Date.parse(user.locked_until) > Date.now());
}

module.exports = {
  ROLES,
  publicUser,
  getUser,
  findUserByEmail,
  listUsers,
  ownerCount,
  ensureOwnerMigration,
  createUser,
  updateUser,
  deleteUser,
  setTotp,
  totpSecret,
  consumeBackupCode,
  record2faFailure,
  clear2faFailures,
  isLocked,
};
