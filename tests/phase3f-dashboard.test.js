const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-phase3f-'));
const port = 4399;
const base = `http://127.0.0.1:${port}`;
const panel = spawn(process.execPath, ['app-http.js'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(port),
    PANEL_DATA_ROOT: dataRoot,
    PANEL_SITES_ROOT: path.join(dataRoot, 'sites'),
    PANEL_SECRET_KEY: 'phase3f-secret',
    PANEL_APPLY_SYSTEM: '0',
  },
  stdio: 'ignore',
});

test.after(() => panel.kill());

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/dashboard`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Phase 3F API did not start');
}

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function createSite(name = 'Dashboard App') {
  const { response, payload } = await json(`${base}/api/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      repo: 'git@github.com:example/dashboard-app.git',
      name,
      type: 'static',
    }),
  });
  assert.equal(response.status, 201);
  return payload;
}

test('file manager lists, writes, renames, and blocks traversal', async () => {
  await waitForServer();
  const site = await createSite();
  const list = await json(`${base}/api/sites/${site.slug}/files?path=.`);
  assert.equal(list.response.status, 200);
  assert.ok(Array.isArray(list.payload.entries));

  const write = await json(`${base}/api/sites/${site.slug}/files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'uploads/readme.txt', content: 'phase3f upload' }),
  });
  assert.equal(write.response.status, 200);

  const read = await json(`${base}/api/sites/${site.slug}/files/content?path=uploads/readme.txt`);
  assert.equal(read.payload.content, 'phase3f upload');

  const rename = await json(`${base}/api/sites/${site.slug}/files`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'rename', path: 'uploads/readme.txt', target: 'uploads/renamed.txt' }),
  });
  assert.equal(rename.response.status, 200);
  assert.ok(fs.existsSync(path.join(dataRoot, 'sites', site.slug, 'app', 'uploads', 'renamed.txt')));

  const traversal = await json(`${base}/api/sites/${site.slug}/files/content?path=../../outside.txt`);
  assert.equal(traversal.response.status, 400);

  const deleteFile = await json(`${base}/api/sites/${site.slug}/files`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'delete', path: 'uploads/renamed.txt' }),
  });
  assert.equal(deleteFile.response.status, 200);
});

test('alert settings persist thresholds and encrypted webhook storage', async () => {
  const current = await json(`${base}/api/alerts`);
  assert.equal(current.response.status, 200);
  assert.equal(current.payload.thresholds.cpu, 90);

  const updated = await json(`${base}/api/alerts`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      cpu: 85,
      memory: 88,
      disk: 92,
      cooldown_minutes: 30,
      discord_webhook: 'https://discord.test/webhook',
    }),
  });
  assert.equal(updated.response.status, 200);

  const saved = await json(`${base}/api/alerts`);
  assert.equal(saved.payload.thresholds.cpu, 85);
  assert.equal(saved.payload.thresholds.memory, 88);
  assert.equal(saved.payload.thresholds.disk, 92);
  assert.equal(saved.payload.cooldown_minutes, 30);
  assert.equal(saved.payload.discord_configured, true);
});

test('service installer exposes allowlist and rejects arbitrary packages', async () => {
  const packages = await json(`${base}/api/system/packages`);
  assert.equal(packages.response.status, 200);
  assert.ok(packages.payload.packages.includes('nginx'));
  assert.ok(packages.payload.packages.includes('fail2ban'));
  assert.ok(packages.payload.packages.includes('redis-server'));
  assert.ok(packages.payload.packages.includes('docker.io'));

  const queued = await json(`${base}/api/system/packages/install`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package: 'nginx' }),
  });
  assert.equal(queued.response.status, 202);
  assert.equal(queued.payload.packages[0], 'nginx');

  const rejected = await json(`${base}/api/system/packages/install`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package: 'bash -c id' }),
  });
  assert.equal(rejected.response.status, 400);
});

test('PHP installer validates versions and queues installs', async () => {
  const inventory = await json(`${base}/api/system/php`);
  assert.equal(inventory.response.status, 200);
  assert.ok(Array.isArray(inventory.payload.versions));
  assert.ok(Array.isArray(inventory.payload.discovered));

  const queued = await json(`${base}/api/system/php/install`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: '8.3' }),
  });
  assert.equal(queued.response.status, 202);
  assert.equal(queued.payload.version, '8.3');
  assert.ok(queued.payload.extensions.includes('fpm'));

  const rejected = await json(`${base}/api/system/php/install`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: '8.3; rm -rf /' }),
  });
  assert.equal(rejected.response.status, 400);
});

test('host services endpoint lists systemd units and rejects unsafe unit names', async () => {
  const listed = await json(`${base}/api/system/services`);
  assert.equal(listed.response.status, 200);
  assert.ok(Array.isArray(listed.payload.services));

  const unsafe = await json(`${base}/api/system/services/${encodeURIComponent('nginx;id.service')}/start`, { method: 'POST' });
  assert.equal(unsafe.response.status, 400);

  const missingSuffix = await json(`${base}/api/system/services/nginx/start`, { method: 'POST' });
  assert.ok([400, 404].includes(missingSuffix.response.status));

  const generated = await json(`${base}/api/system/services/nginx.service/start`, { method: 'POST' });
  assert.equal(generated.response.status, 200);
  assert.equal(generated.payload.applied, false);
  assert.equal(generated.payload.unitName, 'nginx.service');
});

test('wordpress API reports availability without shell injection', async () => {
  const site = await createSite('WordPress App');
  const status = await json(`${base}/api/sites/${site.slug}/wordpress`);
  assert.equal(status.response.status, 200);
  assert.equal(typeof status.payload.available, 'boolean');

  const unsafe = await json(`${base}/api/sites/${site.slug}/wordpress/plugin_activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args: ['../unsafe'] }),
  });
  assert.equal(unsafe.response.status, 400);
});

test('feature catalog lists Phase 3F dashboard workflows', async () => {
  const { payload } = await json(`${base}/api/system/features`);
  for (const feature of ['file_manager', 'alerts', 'service_installer', 'host_services', 'php_installer']) {
    assert.equal(payload[feature].status, 'available');
  }
  assert.ok(['available', 'not_installed'].includes(payload.wordpress.status));
});
