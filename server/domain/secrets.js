/**
 * AES-256-GCM field encryption for sensitive values stored in SQLite.
 * Key is derived from PANEL_SECRET_KEY env var.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALG = 'aes-256-gcm';

function getKey() {
  const raw = process.env.PANEL_SECRET_KEY ?? '';
  if (!raw) throw new Error('PANEL_SECRET_KEY not set');
  return scryptSync(raw, 'iqpanel-field-v1', 32);
}

function asUtf8String(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  return String(value);
}

export function encryptField(plaintext) {
  if (!plaintext) return '';
  const key  = getKey();
  const iv   = randomBytes(12);
  const c    = createCipheriv(ALG, key, iv);
  const enc  = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  const tag  = c.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptField(ciphertext) {
  const raw = asUtf8String(ciphertext);
  if (!raw) return '';
  try {
    const key  = getKey();
    const buf  = Buffer.from(raw, 'base64');
    if (buf.length < 28) throw new Error('ciphertext too short');
    const iv   = buf.subarray(0, 12);
    const tag  = buf.subarray(12, 28);
    const enc  = buf.subarray(28);
    const d    = createDecipheriv(ALG, key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch (e) {
    if (e?.reason === 'decrypt_failed') throw e;
    const err = new Error('Stored password cannot be decrypted. The panel secret key may have changed.');
    err.reason = 'decrypt_failed';
    err.cause = e;
    throw err;
  }
}

export function tryDecryptField(ciphertext) {
  const raw = asUtf8String(ciphertext);
  if (!raw) return { ok: true, password: '', reason: 'no_password' };
  try {
    return { ok: true, password: decryptField(raw) };
  } catch (e) {
    if (e.reason === 'decrypt_failed') return { ok: false, password: '', reason: 'decrypt_failed' };
    throw e;
  }
}
