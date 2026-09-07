const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-phase3e-'));
const port = 4398;
const base = `http://127.0.0.1:${port}`;
const panel = spawn(process.execPath, ['app-http.js'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(port),
    PANEL_DATA_ROOT: dataRoot,
    PANEL_SITES_ROOT: path.join(dataRoot, 'sites'),
    PANEL_SECRET_KEY: 'phase3e-secret',
    PANEL_APPLY_SYSTEM: '0',
    PANEL_AUTHORIZED_KEYS_PATH: path.join(dataRoot, 'ssh', 'authorized_keys'),
  },
  stdio: 'ignore',
});

test.after(() => panel.kill());

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/system/features`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Phase 3E API did not start');
}

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

test('feature catalog lists every Phase 3E integration', async () => {
  await waitForServer();
  const { payload } = await json(`${base}/api/system/features`);
  for (const feature of [
    'openlitespeed',
    'cloudflare',
    'mail_server',
    'fail2ban',
    'swap_and_disk',
    'ssh_keys',
    'stack_presets',
    'phpmyadmin',
    'disk_extension',
  ]) {
    assert.ok(payload[feature], `missing ${feature}`);
    assert.ok(['available', 'configurable'].includes(payload[feature].status), `${feature} status`);
  }
});

test('swap and disk extension stay generated-only without PANEL_APPLY_SYSTEM', async () => {
  const swap = await json(`${base}/api/system/swap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'enable', size_mb: 512 }),
  });
  assert.equal(swap.response.status, 200);
  assert.equal(swap.payload.applied, false);
  assert.equal(swap.payload.size_mb, 512);

  const dryRun = await json(`${base}/api/system/disk/extend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device: '/dev/vg0/app', mode: 'lvm', confirm: false }),
  });
  assert.equal(dryRun.response.status, 200);
  assert.equal(dryRun.payload.dry_run, true);

  const invalid = await json(`${base}/api/system/disk/extend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device: '/tmp/unsafe', mode: 'lvm', confirm: false }),
  });
  assert.equal(invalid.response.status, 400);
});

test('SSH authorized key management validates input and is idempotent', async () => {
  const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE2testkey panel';
  const add = await json(`${base}/api/system/ssh-keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'add', key }),
  });
  assert.equal(add.response.status, 200);
  assert.equal(add.payload.changed, true);

  const again = await json(`${base}/api/system/ssh-keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'add', key }),
  });
  assert.equal(again.response.status, 200);
  assert.equal(again.payload.changed, false);

  const listed = await json(`${base}/api/system/ssh-keys`);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.payload.keys.length, 1);

  const invalid = await json(`${base}/api/system/ssh-keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'add', key: 'not-a-key' }),
  });
  assert.equal(invalid.response.status, 400);
});

test('fail2ban, mail, openlitespeed, and phpmyadmin endpoints respond', async () => {
  const fail2ban = await json(`${base}/api/system/fail2ban`);
  assert.equal(fail2ban.response.status, 200);
  assert.equal(typeof fail2ban.payload.available, 'boolean');

  const mail = await json(`${base}/api/system/mail`);
  assert.equal(mail.response.status, 200);
  assert.equal(typeof mail.payload.postfix, 'string');
  assert.equal(typeof mail.payload.dovecot, 'string');

  const ols = await json(`${base}/api/system/openlitespeed`);
  assert.equal(ols.response.status, 200);
  assert.equal(typeof ols.payload.available, 'object');

  const phpmyadmin = await json(`${base}/api/system/phpmyadmin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'admin.local' }),
  });
  assert.equal(phpmyadmin.response.status, 200);
  assert.equal(phpmyadmin.payload.applied, false);
});

test('cloudflare token storage and DNS validation reject unsafe input', async () => {
  const status = await json(`${base}/api/system/cloudflare`);
  assert.equal(status.response.status, 200);
  assert.equal(status.payload.configured, false);

  const shortToken = await json(`${base}/api/system/cloudflare`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'too-short' }),
  });
  assert.equal(shortToken.response.status, 400);

  const stored = await json(`${base}/api/system/cloudflare`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'cloudflare-token-with-valid-length' }),
  });
  assert.equal(stored.response.status, 200);
  assert.equal(stored.payload.configured, true);

  const configured = await json(`${base}/api/system/cloudflare`);
  assert.equal(configured.payload.configured, true);

  const badDns = await json(`${base}/api/system/cloudflare/dns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ zone_id: 'not-a-zone', type: 'TXT', name: 'app', content: 'value' }),
  });
  assert.equal(badDns.response.status, 400);
});
