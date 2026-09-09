/**
 * Webhook HMAC signature verification tests.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';

function computeSig(secret, body) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function verifySig(secret, body, sig) {
  const expected = Buffer.from(computeSig(secret, body));
  const provided = Buffer.from(String(sig));
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(expected, provided);
}

describe('Webhook signature verification', () => {
  const secret = 'test-webhook-secret-xyz';
  const body   = JSON.stringify({ ref: 'refs/heads/main', after: 'abc123' });

  test('accepts valid signature', () => {
    const sig = computeSig(secret, body);
    assert.ok(verifySig(secret, body, sig));
  });

  test('rejects wrong secret', () => {
    const sig = computeSig('wrong-secret', body);
    assert.ok(!verifySig(secret, body, sig));
  });

  test('rejects tampered body', () => {
    const sig = computeSig(secret, body);
    assert.ok(!verifySig(secret, body + 'x', sig));
  });

  test('rejects empty signature', () => {
    assert.ok(!verifySig(secret, body, ''));
  });

  test('rejects malformed signature', () => {
    assert.ok(!verifySig(secret, body, 'sha256=notahex'));
  });
});
