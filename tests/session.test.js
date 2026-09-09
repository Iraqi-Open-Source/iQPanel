/**
 * Tests for session, password hashing, TOTP, CSRF.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set up test DB
process.env.PANEL_DATA_ROOT = mkdtempSync(join(tmpdir(), 'iqpanel-test-'));
process.env.PANEL_SECRET_KEY = 'test-secret-key-for-tests-only-32';

const { hashPassword, verifyPassword, generateTotpSecret, verifyTotp, csrfToken, verifyCsrf,
        createSession, getSession, destroySession }
  = await import('../server/http/session.js');
const { run } = await import('../server/data/db.js');

describe('Password hashing', () => {
  test('verifies correct password', () => {
    const { hash, salt } = hashPassword('MyPassword123');
    assert.ok(verifyPassword('MyPassword123', hash, salt));
  });

  test('rejects wrong password', () => {
    const { hash, salt } = hashPassword('MyPassword123');
    assert.ok(!verifyPassword('WrongPassword', hash, salt));
  });

  test('produces different salts each time', () => {
    const a = hashPassword('same');
    const b = hashPassword('same');
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.hash, b.hash);
  });
});

describe('TOTP', () => {
  test('generates secret and verifies code', () => {
    const secret = generateTotpSecret();
    assert.ok(secret.length >= 16);
    // Can't test exact code without a known TOTP fixture
    // but at least verify it doesn't throw
    assert.equal(typeof verifyTotp(secret, '000000'), 'boolean');
  });
});

describe('CSRF', () => {
  test('generates deterministic token', () => {
    const tok = csrfToken('session-token-abc');
    assert.equal(tok.length, 64);
    assert.equal(csrfToken('session-token-abc'), tok);
  });

  test('verifies correct token', () => {
    const tok = csrfToken('sess-xyz');
    assert.ok(verifyCsrf('sess-xyz', tok));
  });

  test('rejects wrong token', () => {
    assert.ok(!verifyCsrf('sess-xyz', 'wrong'));
  });
});

describe('Sessions', () => {
  test('creates and retrieves session', () => {
    run('INSERT INTO users (id,email,name,role,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?,?)',
      ['user-123', 'a@test', 'A', 'operator', 'h', 's', new Date().toISOString()]);
    const token = createSession('user-123');
    const sess  = getSession(token);
    assert.ok(sess);
    assert.equal(sess.user_id, 'user-123');
  });

  test('returns null after destroy', () => {
    run('INSERT INTO users (id,email,name,role,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?,?)',
      ['user-456', 'b@test', 'B', 'operator', 'h', 's', new Date().toISOString()]);
    const token = createSession('user-456');
    destroySession(token);
    assert.equal(getSession(token), null);
  });

  test('returns null for unknown token', () => {
    assert.equal(getSession('nonexistent-token'), null);
  });
});
