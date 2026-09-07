const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-test-'));
const port = 4387;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['app-http.js'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(port),
    PANEL_DATA_ROOT: dataRoot,
    PANEL_SITES_ROOT: path.join(dataRoot, 'sites'),
    PANEL_SECRET_KEY: 'api-test-secret',
    PANEL_APPLY_SYSTEM: '0',
  },
  stdio: 'ignore',
});

test.after(() => server.kill());

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/dashboard`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('API did not start');
}

test('dashboard API starts with an empty persistent store', async () => {
  await waitForServer();
  const response = await fetch(`${base}/api/dashboard`);
  assert.equal(response.status, 200);
  const dashboard = await response.json();
  assert.deepEqual(dashboard.sites, []);
  assert.equal(dashboard.server.agent, 'online');
  assert.equal(typeof dashboard.server.cpu, 'number');
});

test('panel update requests are queued without changing generated-only installations', async () => {
  const response = await fetch(`${base}/api/system/update`, { method: 'POST' });
  assert.equal(response.status, 202);
  const payload = await response.json();
  const job = await waitForJob(payload.job_id);
  assert.equal(job.status, 'failed');
  assert.match(job.last_error, /PANEL_APPLY_SYSTEM=1/);
});

test('site creation persists a generated deploy key and rendered config', async () => {
  const response = await fetch(`${base}/api/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repo: 'git@github.com:example/demo.git', name: 'Demo App', type: 'php', server: 'Nginx' }),
  });
  assert.equal(response.status, 201);
  const site = await response.json();
  assert.equal(site.slug, 'demo-app');
  assert.equal(site.app_port, 9100);
  assert.match(site.deploy_key_public, /^ssh-ed25519 /);
  assert.ok(fs.existsSync(path.join(dataRoot, 'generated', 'nginx', 'demo-app.conf')));
  assert.ok(fs.existsSync(path.join(dataRoot, 'sites', 'demo-app', '.ssh', 'id_ed25519')));
});

test('database create returns the password once and never lists secrets', async () => {
  const created = await fetch(`${base}/api/databases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ site_slug: 'demo-app', db_name: 'demo_app', db_user: 'demo_app_user', mode: 'create' }),
  });
  assert.equal(created.status, 201);
  const database = await created.json();
  assert.ok(database.password);
  assert.equal(database.granted, false);
  assert.equal(database.password_ciphertext, undefined);
  const listed = await (await fetch(`${base}/api/databases`)).json();
  assert.equal(listed[0].password, undefined);
  assert.equal(listed[0].password_ciphertext, undefined);
  const sql = fs.readFileSync(path.join(dataRoot, 'generated', 'mysql', 'demo_app.sql'), 'utf8');
  assert.match(sql, /GRANT ALL PRIVILEGES/);
});

test('on-demand MySQL dump fails without a live socket', async () => {
  const databases = await (await fetch(`${base}/api/databases`)).json();
  const response = await fetch(`${base}/api/databases/${databases[0].id}/dump`, { method: 'POST' });
  assert.equal(response.status, 202);
  const job = await response.json();
  const finished = await waitForJob(job.job_id);
  assert.equal(finished.status, 'failed');
});

test('backup jobs apply retention and record local archives', async () => {
  for (let index = 0; index < 3; index += 1) {
    const response = await fetch(`${base}/api/sites/demo-app/backup`, { method: 'POST' });
    const payload = await response.json();
    await waitForJob(payload.job_id);
  }
  const backups = await (await fetch(`${base}/api/backups`)).json();
  const siteBackups = backups.filter((item) => item.path && item.path.includes(`${path.sep}demo-app${path.sep}`) && item.path.endsWith('files.tar.gz'));
  assert.ok(siteBackups.length <= 5);
  assert.ok(fs.readdirSync(path.join(dataRoot, 'backups', 'demo-app')).length <= 5);
});

test('log discovery and snapshot are available for a site', async () => {
  const laravelLog = path.join(dataRoot, 'sites', 'demo-app', 'app', 'storage', 'logs', 'laravel.log');
  fs.mkdirSync(path.dirname(laravelLog), { recursive: true });
  fs.writeFileSync(laravelLog, '[2026-09-06] production.INFO: ready\n');
  const sources = await (await fetch(`${base}/api/sites/demo-app/logs`)).json();
  assert.equal(sources.some((source) => source.name === 'laravel'), true);
  const snapshot = await (await fetch(`${base}/api/sites/demo-app/logs/laravel`)).json();
  assert.match(snapshot.text, /production.INFO/);
});

test('creates an Apache site and renders an Apache vhost', async () => {
  const response = await fetch(`${base}/api/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repo: 'git@github.com:example/apache.git', name: 'Apache Site', type: 'php', server: 'Apache' }),
  });
  assert.equal(response.status, 201);
  const site = await response.json();
  assert.equal(site.webserver, 'apache');
});

async function waitForJob(jobId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${base}/api/jobs/${jobId}`);
    const job = await response.json();
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`job ${jobId} did not finish`);
}
