const crypto = require('node:crypto');

const SALT = 'iqpanel-secret';

function key() {
  const secret = process.env.PANEL_SECRET_KEY || 'dev-only-do-not-use-in-production';
  return crypto.scryptSync(secret, SALT, 32);
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(payload) {
  const [ivHex, tagHex, dataHex] = String(payload || '').split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Invalid secret payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

function password() {
  return crypto.randomBytes(18).toString('base64url');
}

function hashPassword(value) {
  return crypto.scryptSync(String(value), 'iqpanel-admin', 32).toString('hex');
}

function verifyPassword(value, expectedHex) {
  const actual = Buffer.from(hashPassword(value), 'hex');
  const expected = Buffer.from(String(expectedHex || ''), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { encrypt, decrypt, password, hashPassword, verifyPassword };
