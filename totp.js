const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  const bytes = Buffer.from(buffer);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text) {
  const cleaned = String(text || '').toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of cleaned) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1e6;
  return String(code).padStart(6, '0');
}

function totp(secret, at = Date.now()) {
  return hotp(secret, Math.floor(at / 30000));
}

function verifyTotp(secret, code, at = Date.now()) {
  const expected = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(expected)) return false;
  for (const delta of [-1, 0, 1]) {
    if (totp(secret, at + delta * 30000) === expected) return true;
  }
  return false;
}

function otpauthUrl(email, secret, issuer = 'iQPanel') {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function generateBackupCodes(count = 8) {
  return Array.from({ length: count }, () => crypto.randomBytes(5).toString('hex'));
}

module.exports = { generateSecret, totp, verifyTotp, otpauthUrl, generateBackupCodes, base32Encode, base32Decode };
