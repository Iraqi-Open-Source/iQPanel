const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-phase2-api-'));
const port = 4391;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['app-http.js'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(port),
    PANEL_DATA_ROOT: dataRoot,
    PANEL_SITES_ROOT: path.join(dataRoot, 'sites'),
    PANEL_SECRET_KEY: 'phase2-api-secret',
    PANEL_PHP_VERSIONS: '8.2,8.3',
    PANEL_NODE_VERSIONS: '20,22',
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
  throw new Error('Phase 2 API did not start');
}

async function waitForJob(jobId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${base}/api/jobs/${jobId}`);
    const job = await response.json();
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`job ${jobId} did not finish`);
}

test('Apache site creation renders an Apache vhost instead of being rejected', async () => {
  await waitForServer();
  const response = await fetch(`${base}/api/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      repo: 'git@github.com:example/apache-app.git',
      name: 'Apache App',
      type: 'php',
      server: 'Apache',
      runtime_version: '8.2',
    }),
  });
  assert.equal(response.status, 201);
  const site = await response.json();
  assert.equal(site.webserver, 'apache');
  assert.equal(site.runtime_version, '8.2');
  assert.ok(fs.existsSync(path.join(dataRoot, 'generated', 'apache', 'apache-app.conf')));
});

test('PostgreSQL databases are accepted and never leak ciphertext', async () => {
  const created = await fetch(`${base}/api/databases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      site_slug: 'apache-app',
      db_name: 'apache_pg',
      db_user: 'apache_pg_user',
      engine: 'postgres',
      mode: 'create',
    }),
  });
  assert.equal(created.status, 201);
  const database = await created.json();
  assert.equal(database.engine, 'postgres');
  assert.ok(database.password);
  assert.equal(database.granted, false);
  const listed = await (await fetch(`${base}/api/databases`)).json();
  const row = listed.find((item) => item.db_name === 'apache_pg');
  assert.equal(row.password, undefined);
  assert.equal(row.password_ciphertext, undefined);
});

test('runtimes, docker, servers, and settings endpoints are available', async () => {
  const runtimes = await (await fetch(`${base}/api/runtimes`)).json();
  assert.deepEqual(runtimes.php, ['8.2', '8.3']);
  const docker = await (await fetch(`${base}/api/docker`)).json();
  assert.equal(docker.available, false);
  const servers = await (await fetch(`${base}/api/servers`)).json();
  assert.equal(servers.some((item) => item.kind === 'local'), true);
  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(settings.telegram_configured, false);
  assert.equal(settings.ftp_configured, false);
});

test('registers a remote server without returning its agent key', async () => {
  const created = await fetch(`${base}/api/servers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Edge VM', host: '10.0.0.8', port: 4174, token: 'remote-agent-key' }),
  });
  assert.equal(created.status, 201);
  const serverRow = await created.json();
  assert.equal(serverRow.name, 'Edge VM');
  assert.equal(serverRow.token, undefined);
  assert.equal(serverRow.token_ciphertext, undefined);
  const listed = await (await fetch(`${base}/api/servers`)).json();
  assert.equal(listed.some((item) => item.name === 'Edge VM' && item.host === '10.0.0.8'), true);
});

test('backup jobs record the requested remote destination', async () => {
  const response = await fetch(`${base}/api/sites/apache-app/backup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ destination: 'telegram' }),
  });
  assert.equal(response.status, 202);
  const payload = await response.json();
  const job = await waitForJob(payload.job_id);
  assert.ok(job.status === 'succeeded' || job.status === 'failed');
  const backups = await (await fetch(`${base}/api/backups`)).json();
  assert.equal(backups.some((item) => item.destination === 'telegram'), true);
});

test('SSL and firewall requests stay generated-only in local mode', async () => {
  await fetch(`${base}/api/sites/apache-app`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'apache.example.test' }),
  });
  const ssl = await fetch(`${base}/api/sites/apache-app/ssl`, { method: 'POST' });
  assert.equal(ssl.status, 200);
  const sslBody = await ssl.json();
  assert.equal(sslBody.applied, false);
  const ufw = await fetch(`${base}/api/sites/apache-app/firewall`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'open' }),
  });
  assert.equal(ufw.status, 200);
  const ufwBody = await ufw.json();
  assert.equal(ufwBody.applied, false);
});

test('terminal sessions echo input without extra packages', async () => {
  const created = await fetch(`${base}/api/terminal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(created.status, 201);
  const session = await created.json();
  await fetch(`${base}/api/terminal/${session.id}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: 'echo phase2-ok\n' }),
  });
  let text = '';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const snapshot = await (await fetch(`${base}/api/terminal/${session.id}`)).json();
    text = snapshot.text || '';
    if (text.includes('phase2-ok')) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.match(text, /phase2-ok/);
  const closed = await fetch(`${base}/api/terminal/${session.id}`, { method: 'DELETE' });
  assert.equal(closed.status, 204);
});

test('feature catalog and secure site file manager are available', async () => {
  const features = await (await fetch(`${base}/api/system/features`)).json();
  assert.equal(features.file_manager.status, 'available');
  assert.equal(features.wordpress.status, 'available');
  assert.equal(features.two_factor.status, 'planned');

  const write = await fetch(`${base}/api/sites/apache-app/files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'storage/panel-test.txt', content: 'safe file manager write' }),
  });
  assert.equal(write.status, 200);
  const read = await (await fetch(`${base}/api/sites/apache-app/files/content?path=storage/panel-test.txt`)).json();
  assert.equal(read.content, 'safe file manager write');

  const traversal = await fetch(`${base}/api/sites/apache-app/files/content?path=../../outside.txt`);
  assert.equal(traversal.status, 400);
});

test('system capabilities and WordPress availability do not require optional tools', async () => {
  const capabilities = await (await fetch(`${base}/api/system/capabilities`)).json();
  assert.equal(typeof capabilities.available, 'object');
  const wordpress = await (await fetch(`${base}/api/sites/apache-app/wordpress`)).json();
  assert.equal(typeof wordpress.available, 'boolean');
});
