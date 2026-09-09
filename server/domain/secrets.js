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
  if (!ciphertext) return '';
  const key  = getKey();
  const buf  = Buffer.from(ciphertext, 'base64');
  const iv   = buf.slice(0, 12);
  const tag  = buf.slice(12, 28);
  const enc  = buf.slice(28);
  const d    = createDecipheriv(ALG, key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
