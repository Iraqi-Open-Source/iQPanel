const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { spawn } = require('node:child_process');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-phase3b-'));
process.env.PANEL_DATA_ROOT = dataRoot;
process.env.PANEL_SITES_ROOT = path.join(dataRoot, 'sites');
process.env.PANEL_SECRET_KEY = 'phase3b-secret';
const port = 4394;
const base = `http://127.0.0.1:${port}`;
const panel = spawn(process.execPath, ['app-http.js'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(port),
    PANEL_DATA_ROOT: dataRoot,
    PANEL_SITES_ROOT: path.join(dataRoot, 'sites'),
    PANEL_SECRET_KEY: 'phase3b-secret',
  },
  stdio: 'ignore',
});

test.after(() => panel.kill());

function sign(body, secret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function waitFor(check, message = 'condition') {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

async function createSite(name = 'Webhook App') {
  const response = await fetch(`${base}/api/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      repo: 'git@github.com:example/webhook-app.git',
      name,
      type: 'static',
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

function testDb() {
  return require('../db');
}

function siteSecret(site) {
  const db = testDb();
  const deployments = require('../deployments');
  const row = db.rows(`SELECT * FROM sites WHERE id=${db.sql(site.id)}`)[0];
  return deployments.webhookSecret(row);
}

test('GitHub webhook verifies signatures and deduplicates deliveries', async () => {
  await waitFor(async () => {
    try {
      return (await fetch(`${base}/api/dashboard`)).ok;
    } catch {
      return false;
    }
  }, 'panel API');

  const site = await createSite();
  const secret = siteSecret(site);
  assert.ok(secret);

  const payload = JSON.stringify({
    ref: 'refs/heads/main',
    after: 'abc123def4567890abcdef1234567890abcdef12',
    repository: { full_name: 'example/webhook-app' },
  });

  const invalid = await fetch(`${base}/api/webhooks/github/${site.id}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': crypto.randomUUID(),
      'x-hub-signature-256': sign(payload, 'wrong-secret'),
    },
    body: payload,
  });
  assert.equal(invalid.status, 401);

  const deliveryId = crypto.randomUUID();
  const valid = await fetch(`${base}/api/webhooks/github/${site.id}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': sign(payload, secret),
    },
    body: payload,
  });
  assert.equal(valid.status, 202);
  const queued = await valid.json();
  assert.equal(queued.deduplicated, false);
  assert.ok(queued.deployment_id);

  const replay = await fetch(`${base}/api/webhooks/github/${site.id}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': sign(payload, secret),
    },
    body: payload,
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).deduplicated, true);
});

test('webhook ignores pushes to non-configured branches', async () => {
  const site = await createSite('Branch Filter App');
  const secret = siteSecret(site);
  const payload = JSON.stringify({
    ref: 'refs/heads/develop',
    after: 'def456abc1237890abcdef1234567890abcdef12',
  });
  const response = await fetch(`${base}/api/webhooks/github/${site.id}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': crypto.randomUUID(),
      'x-hub-signature-256': sign(payload, secret),
    },
    body: payload,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ignored, true);
  assert.equal(body.reason, 'branch_mismatch');
});

test('rollback rejects deployments without a recorded commit SHA', async () => {
  const site = await createSite('Rollback App');
  const db = testDb();
  const deploymentId = crypto.randomUUID();
  db.run(`INSERT INTO deployments (id,site_id,status,log,triggered_by,created_at) VALUES (${db.sql(deploymentId)},${db.sql(site.id)},'succeeded','ok','admin',${db.sql(new Date().toISOString())})`);
  const response = await fetch(`${base}/api/sites/${site.slug}/deployments/${deploymentId}/rollback`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 400);
});

test('concurrent webhook deploys deduplicate while a job is active', async () => {
  const site = await createSite('Dedup App');
  const secret = siteSecret(site);
  const payload = JSON.stringify({
    ref: 'refs/heads/main',
    after: '1111111111111111111111111111111111111111',
  });
  const first = await fetch(`${base}/api/webhooks/github/${site.id}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': crypto.randomUUID(),
      'x-hub-signature-256': sign(payload, secret),
    },
    body: payload,
  });
  assert.equal(first.status, 202);
  const second = await fetch(`${base}/api/webhooks/github/${site.id}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': crypto.randomUUID(),
      'x-hub-signature-256': sign(payload, secret),
    },
    body: payload,
  });
  assert.equal(second.status, 200);
  const body = await second.json();
  assert.equal(body.deduplicated, true);
});

test('rollback checks out a recorded commit and reapplies config', async () => {
  const site = await createSite('Rollback Git App');
  const appPath = path.join(dataRoot, 'sites', site.slug, 'app');
  fs.mkdirSync(appPath, { recursive: true });
  execFileSync('git', ['init'], { cwd: appPath });
  fs.writeFileSync(path.join(appPath, 'index.txt'), 'v1\n');
  execFileSync('git', ['add', 'index.txt'], { cwd: appPath });
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'v1'], { cwd: appPath });
  const first = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appPath, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(appPath, 'index.txt'), 'v2\n');
  execFileSync('git', ['add', 'index.txt'], { cwd: appPath });
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'v2'], { cwd: appPath });

  const db = testDb();
  const deploymentId = crypto.randomUUID();
  db.run(`INSERT INTO deployments (id,site_id,commit_sha,status,log,triggered_by,created_at) VALUES (${db.sql(deploymentId)},${db.sql(site.id)},${db.sql(first)},'succeeded','deployed v1','admin',${db.sql(new Date().toISOString())})`);

  const response = await fetch(`${base}/api/sites/${site.slug}/deployments/${deploymentId}/rollback`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 202);
  const queued = await response.json();
  assert.ok(queued.job_id);

  await waitFor(async () => {
    const job = await (await fetch(`${base}/api/jobs/${queued.job_id}`)).json();
    return job.status === 'succeeded' || job.status === 'failed';
  }, 'rollback job');

  const job = await (await fetch(`${base}/api/jobs/${queued.job_id}`)).json();
  assert.equal(job.status, 'succeeded');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appPath, encoding: 'utf8' }).trim();
  assert.equal(head, first);
  assert.equal(fs.readFileSync(path.join(appPath, 'index.txt'), 'utf8'), 'v1\n');
});
