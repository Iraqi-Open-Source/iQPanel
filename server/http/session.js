/**
 * Session, auth, TOTP, CSRF, re-auth.
 * Sessions are stored in SQLite so they survive service restarts.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHmac, createHash } from 'node:crypto';
import { query, get, run } from '../data/db.js';

const SESSION_TTL_MS   = 12 * 60 * 60 * 1000;  // 12 h
const REAUTH_TTL_MS    = 10 * 60 * 1000;         // 10 min
const MAX_FAILED_LOGIN = 5;
const LOCKOUT_MS       = 15 * 60 * 1000;

// ──────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────

function nowMs()  { return Date.now(); }
function nowIso() { return new Date().toISOString(); }
function uuid()   { return randomBytes(16).toString('hex'); }

// ──────────────────────────────────────────────────
// Password hashing (scrypt, per-user salt)
// ──────────────────────────────────────────────────

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const derived = scryptSync(password, salt, 32);
  const stored  = Buffer.from(hash, 'hex');
  return timingSafeEqual(derived, stored);
}

// ──────────────────────────────────────────────────
// TOTP (RFC 6238 HMAC-SHA1, 30 s window)
// ──────────────────────────────────────────────────

export function generateTotpSecret() {
  const bytes = randomBytes(20);
  return base32Encode(bytes);
}

export function verifyTotp(secret, code, window = 1) {
  const now = Math.floor(Date.now() / 30_000);
  for (let i = -window; i <= window; i++) {
    if (computeTotp(secret, now + i) === String(code).padStart(6, '0')) return true;
  }
  return false;
}

function computeTotp(secret, counter) {
  const key    = base32Decode(secret);
  const msg    = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac   = createHmac('sha1', key).update(msg).digest();
  const offset = hmac[19] & 0xf;
  const code   = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let result = '';
  let bits = 0, value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; result += BASE32_CHARS[(value >> bits) & 31]; }
  }
  if (bits > 0) result += BASE32_CHARS[(value << (5 - bits)) & 31];
  return result;
}

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/=/g, '');
  const bytes = [];
  let bits = 0, value = 0;
  for (const c of clean) {
    const idx = BASE32_CHARS.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 0xff); }
  }
  return Buffer.from(bytes);
}

// ──────────────────────────────────────────────────
// Sessions
// ──────────────────────────────────────────────────

export function createSession(userId) {
  const token   = randomBytes(32).toString('hex');
  const expires = nowMs() + SESSION_TTL_MS;
  run('INSERT INTO sessions (token, user_id, reauth_until, expires) VALUES (?, ?, 0, ?)',
    [token, userId, expires]);
  return token;
}

export function getSession(token) {
  if (!token) return null;
  const sess = get('SELECT * FROM sessions WHERE token = ?', [token]);
  if (!sess) return null;
  if (sess.expires < nowMs()) {
    run('DELETE FROM sessions WHERE token = ?', [token]);
    return null;
  }
  return sess;
}

export function destroySession(token) {
  run('DELETE FROM sessions WHERE token = ?', [token]);
}

export function refreshReauth(token) {
  run('UPDATE sessions SET reauth_until = ? WHERE token = ?',
    [nowMs() + REAUTH_TTL_MS, token]);
}

export function isReauthValid(sess) {
  return sess && sess.reauth_until > nowMs();
}

export function purgeExpiredSessions() {
  run('DELETE FROM sessions WHERE expires < ?', [nowMs()]);
}

// ──────────────────────────────────────────────────
// CSRF (double-submit cookie)
// ──────────────────────────────────────────────────

export function csrfToken(sessionToken) {
  return createHash('sha256').update(`csrf:${sessionToken}`).digest('hex');
}

export function verifyCsrf(sessionToken, provided) {
  const expected = Buffer.from(csrfToken(sessionToken));
  const actual   = Buffer.from(String(provided ?? ''));
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(expected, actual);
}

// ──────────────────────────────────────────────────
// User lookup & lockout
// ──────────────────────────────────────────────────

export function findUserByEmail(email) {
  return get('SELECT * FROM users WHERE email = ?', [email]);
}

export function findUserById(id) {
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

export function recordFailedLogin(userId) {
  run('UPDATE users SET failed_login = failed_login + 1, locked_until = ? WHERE id = ?',
    [new Date(nowMs() + LOCKOUT_MS).toISOString(), userId]);
}

export function clearFailedLogin(userId) {
  run('UPDATE users SET failed_login = 0, locked_until = NULL WHERE id = ?', [userId]);
}

export function isLocked(user) {
  if (!user.locked_until) return false;
  if (user.failed_login < MAX_FAILED_LOGIN) return false;
  return new Date(user.locked_until).getTime() > nowMs();
}
