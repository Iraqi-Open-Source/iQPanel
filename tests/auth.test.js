const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-auth-'));
const port = 4388;
const password = 'correct-horse-battery';
const hash = crypto.scryptSync(password, 'iqpanel-admin', 32).toString('hex');
let authedCookie = '';
const server = spawn(process.execPath, ['app-http.js'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(port),
    PANEL_DATA_ROOT: dataRoot,
    PANEL_SITES_ROOT: path.join(dataRoot, 'sites'),
    PANEL_ADMIN_PASSWORD_HASH: hash,
    PANEL_SECRET_KEY: 'auth-test-secret',
  },
  stdio: 'ignore',
});

test.after(() => server.kill());

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/session`);
      if (response.status === 401 || response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('auth API did not start');
}

test('rejects unauthenticated API access when an admin hash is configured', async () => {
  await waitForServer();
  const response = await fetch(`http://127.0.0.1:${port}/api/sites`);
  assert.equal(response.status, 401);
});

test('authenticates with the admin password and rate-limits failures', async () => {
  const ok = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /iqpanel_session=/);
  authedCookie = cookie;
  const sites = await fetch(`http://127.0.0.1:${port}/api/sites`, { headers: { cookie } });
  assert.equal(sites.status, 200);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify({ password: 'wrong' }),
    });
  }
  const limited = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify({ password: 'wrong' }),
  });
  assert.equal(limited.status, 429);
});

test('logout clears the session cookie', async () => {
  const login = await fetch(`http://127.0.0.1:${port}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const cookie = login.headers.get('set-cookie');
  const logout = await fetch(`http://127.0.0.1:${port}/api/logout`, { method: 'POST', headers: { cookie } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});

test('sessions survive a server restart', async () => {
  assert.ok(authedCookie, 'login cookie captured');
  const second = spawn(process.execPath, ['app-http.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port + 1),
      PANEL_DATA_ROOT: dataRoot,
      PANEL_SITES_ROOT: path.join(dataRoot, 'sites'),
      PANEL_ADMIN_PASSWORD_HASH: hash,
      PANEL_SECRET_KEY: 'auth-test-secret',
    },
    stdio: 'ignore',
  });
  test.after(() => second.kill());
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port + 1}/api/session`);
      if (response.status === 401 || response.ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'second server did not start');
  const sites = await fetch(`http://127.0.0.1:${port + 1}/api/sites`, { headers: { cookie: authedCookie } });
  assert.equal(sites.status, 200);
});
