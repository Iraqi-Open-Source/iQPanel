const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PANEL_SECRET_KEY = 'test-secret-key-for-unit-tests';
const secrets = require('../secrets');

test('encrypts secrets and decrypts them back', () => {
  const encrypted = secrets.encrypt('mysql-password');
  assert.notEqual(encrypted, 'mysql-password');
  assert.doesNotMatch(encrypted, /mysql-password/);
  assert.equal(secrets.decrypt(encrypted), 'mysql-password');
});

test('generates a URL-safe password', () => {
  assert.match(secrets.password(), /^[A-Za-z0-9_-]{16,}$/);
});
