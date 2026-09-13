import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { encryptField, decryptField, tryDecryptField } from '../server/domain/secrets.js';

process.env.PANEL_SECRET_KEY = 'test-secret-key-for-decrypt-tests-32';

describe('field encryption', () => {
  test('roundtrips', () => {
    const enc = encryptField('s3cret');
    assert.equal(decryptField(enc), 's3cret');
  });

  test('empty stays empty', () => {
    assert.equal(decryptField(''), '');
    assert.equal(tryDecryptField('').reason, 'no_password');
  });

  test('wrong key is decrypt_failed not a crypto dump', () => {
    const enc = encryptField('s3cret');
    process.env.PANEL_SECRET_KEY = 'other-secret-key-for-decrypt-tests';
    const got = tryDecryptField(enc);
    assert.equal(got.ok, false);
    assert.equal(got.reason, 'decrypt_failed');
    assert.throws(() => decryptField(enc), /secret key may have changed/);
    process.env.PANEL_SECRET_KEY = 'test-secret-key-for-decrypt-tests-32';
  });
});
