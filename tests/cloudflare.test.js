import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PANEL_DATA_ROOT = mkdtempSync(join(tmpdir(), 'iqpanel-cf-'));
process.env.PANEL_SECRET_KEY = 'test-secret-key-for-tests-only-32';

const { get, run } = await import('../server/data/db.js');
const { encryptField } = await import('../server/domain/secrets.js');
const {
  autoDnsEnabled,
  isIpAddress,
  matchZone,
  recordName,
  tokenConfigured,
} = await import('../server/domain/cloudflare.js');

test('matchZone picks the longest suffix', () => {
  const zones = [
    { id: '1', name: 'example.com' },
    { id: '2', name: 'app.example.com' },
    { id: '3', name: 'other.net' },
  ];
  assert.equal(matchZone('app.example.com', zones).id, '2');
  assert.equal(matchZone('API.APP.EXAMPLE.COM.', zones).id, '2');
  assert.equal(matchZone('example.com', zones).id, '1');
  assert.equal(matchZone('not-example.com', zones), null);
});

test('recordName builds a hostname under the zone', () => {
  assert.equal(recordName('App', 'Example.com'), 'app.example.com');
  assert.equal(recordName('', 'example.com'), 'example.com');
  assert.equal(recordName('@', 'example.com'), 'example.com');
  assert.equal(recordName('app.example.com', 'example.com'), 'app.example.com');
  assert.equal(recordName('*', 'example.com'), '*.example.com');
});

test('isIpAddress accepts v4 and v6', () => {
  assert.equal(isIpAddress('203.0.113.10'), true);
  assert.equal(isIpAddress('999.0.0.1'), false);
  assert.equal(isIpAddress('01.2.3.4'), false);
  assert.equal(isIpAddress('2001:db8::1'), true);
  assert.equal(isIpAddress('not-an-ip'), false);
});

test('auto DNS follows an explicit flag, then the saved setting', () => {
  assert.equal(autoDnsEnabled(true), true);
  assert.equal(autoDnsEnabled('0'), false);
  assert.equal(autoDnsEnabled(undefined), false);
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['cloudflare_auto_dns', '1'],
  );
  assert.equal(autoDnsEnabled(undefined), true);
  assert.equal(autoDnsEnabled(false), false);
});

test('tokenConfigured ignores the encrypted value until a token is stored', () => {
  assert.equal(tokenConfigured(), false);
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?)',
    ['cloudflare_api_token', encryptField('cf-token')],
  );
  assert.equal(tokenConfigured(), true);
  const stored = get('SELECT value FROM settings WHERE key = ?', ['cloudflare_api_token']);
  assert.equal(stored.value.includes('cf-token'), false);
});

test('migration creates cloudflare_dns_records', () => {
  const row = get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cloudflare_dns_records'");
  assert.ok(row);
});
