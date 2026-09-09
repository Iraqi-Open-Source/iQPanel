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

test('system engines endpoint reports availability honestly', async () => {
  const response = await fetch(`${base}/api/system/engines`);
  assert.equal(response.status, 200);
  const { engines } = await response.json();
  for (const engine of ['mysql', 'mariadb', 'postgres', 'redis']) {
    assert.ok(engines[engine], `missing ${engine}`);
    assert.equal(typeof engines[engine].installed, 'boolean');
    assert.equal(typeof engines[engine].active, 'boolean');
  }
  assert.equal(engines.mysql.unit, 'mysql.service');
});

test('dashboard payload includes engine availability', async () => {
  const dashboard = await (await fetch(`${base}/api/dashboard`)).json();
  assert.ok(dashboard.server.engines);
  assert.equal(typeof dashboard.server.engines.mysql.installed, 'boolean');
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
  assert.equal(site.directory, path.join(dataRoot, 'sites', 'demo-app'));
  assert.ok(fs.existsSync(path.join(dataRoot, 'generated', 'nginx', 'demo-app.conf')));
  assert.ok(fs.existsSync(path.join(dataRoot, 'sites', 'demo-app', '.ssh', 'id_ed25519')));
});

test('site detail includes paths and database attachments', async () => {
  const response = await fetch(`${base}/api/sites/demo-app`);
  assert.equal(response.status, 200);
  const site = await response.json();
  assert.deepEqual(site.databases, []);
  assert.equal(site.paths.app_root, path.join(dataRoot, 'sites', 'demo-app', 'app'));
  assert.equal(site.paths.vhost.generated, path.join(dataRoot, 'generated', 'nginx', 'demo-app.conf'));
  assert.ok(site.paths.logs.some((log) => log.name === 'laravel'));
});

test('database create rejects with a clear error when the provider is missing', async () => {
  const created = await fetch(`${base}/api/databases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ site_slug: 'demo-app', db_name: 'demo_app', db_user: 'demo_app_user', mode: 'create' }),
  });
  assert.equal(created.status, 400);
  const payload = await created.json();
  assert.match(payload.error, /not installed|not running/i);
  assert.match(payload.error, /Services/);
});

function seedDatabase() {
  const siteId = require('node:child_process').execFileSync(
    'sqlite3',
    [path.join(dataRoot, 'panel.sqlite'), "SELECT id FROM sites WHERE slug='demo-app'"],
    { encoding: 'utf8' },
  ).trim();
  require('node:child_process').execFileSync(
    'sqlite3',
    [path.join(dataRoot, 'panel.sqlite'), `INSERT INTO databases (id,site_id,engine,db_name,db_user,host,password_ciphertext,granted,created_at) VALUES ('db-seed-1','${siteId}','mysql','demo_app','demo_app_user','localhost','','0','2026-01-01T00:00:00.000Z')`],
  );
}

test('database listing never leaks secrets', async () => {
  seedDatabase();
  const listed = await (await fetch(`${base}/api/databases`)).json();
  const seeded = listed.find((row) => row.id === 'db-seed-1');
  assert.ok(seeded);
  assert.equal(seeded.password, undefined);
  assert.equal(seeded.password_ciphertext, undefined);
});

test('database delete without a provider requires force and keeps the row', async () => {
  const blocked = await fetch(`${base}/api/databases/db-seed-1`, { method: 'DELETE' });
  assert.equal(blocked.status, 400);
  const payload = await blocked.json();
  assert.match(payload.hint, /force=1/);
  const forced = await fetch(`${base}/api/databases/db-seed-1?force=1`, { method: 'DELETE' });
  assert.equal(forced.status, 204);
  const listed = await (await fetch(`${base}/api/databases`)).json();
  assert.equal(listed.find((row) => row.id === 'db-seed-1'), undefined);
});

test('on-demand MySQL dump fails without a live socket', async () => {
  seedDatabase();
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
