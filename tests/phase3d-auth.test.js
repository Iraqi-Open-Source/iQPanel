const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const totp = require('../totp');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-phase3d-'));
const port = 4397;
const password = 'correct-horse-battery';
const hash = crypto.scryptSync(password, 'iqpanel-admin', 32).toString('hex');
const base = `http://127.0.0.1:${port}`;

const panel = spawn(process.execPath, ['app-http.js'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(port),
    PANEL_DATA_ROOT: dataRoot,
    PANEL_SITES_ROOT: path.join(dataRoot, 'sites'),
    PANEL_ADMIN_PASSWORD_HASH: hash,
    PANEL_SECRET_KEY: 'phase3d-secret',
  },
  stdio: 'ignore',
});

test.after(() => panel.kill());

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/session`);
      if (response.status === 401 || response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Phase 3D API did not start');
}

function cookieHeader(response) {
  return response.headers.get('set-cookie');
}

async function login(body) {
  const response = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, cookie: cookieHeader(response), payload: await response.json() };
}

test('TOTP codes verify within a 30-second window', () => {
  const secret = totp.generateSecret();
  const code = totp.totp(secret);
  assert.equal(totp.verifyTotp(secret, code), true);
  assert.equal(totp.verifyTotp(secret, '000000'), false);
});

test('migrates the admin password hash to an owner and records audit actors', async () => {
  await waitForServer();
  const session = await (await fetch(`${base}/api/session`)).json();
  assert.equal(session.authenticated, false);
  const { response, cookie, payload } = await login({ password });
  assert.equal(response.status, 200);
  assert.equal(payload.user.role, 'owner');
  assert.equal(payload.user.email, 'admin');
  const users = await (await fetch(`${base}/api/users`, { headers: { cookie } })).json();
  assert.equal(users[0].role, 'owner');
  const audit = await (await fetch(`${base}/api/audit?action=Admin%20signed%20in`, { headers: { cookie } })).json();
  assert.ok(audit.items.some((item) => item.user_id === users[0].id));
});

test('readonly users cannot open a terminal or delete a site', async () => {
  const owner = await login({ password });
  const created = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: owner.cookie },
    body: JSON.stringify({ email: 'reader', name: 'Reader', role: 'readonly', password: 'readonly1' }),
  });
  assert.equal(created.status, 201);
  const site = await fetch(`${base}/api/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: owner.cookie },
    body: JSON.stringify({ repo: 'git@github.com:example/role-site.git', name: 'Role Site', type: 'static' }),
  });
  assert.equal(site.status, 201);
  const reader = await login({ email: 'reader', password: 'readonly1' });
  assert.equal(reader.response.status, 200);
  const terminal = await fetch(`${base}/api/terminal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: reader.cookie },
    body: '{}',
  });
  assert.equal(terminal.status, 403);
  const deleted = await fetch(`${base}/api/sites/role-site`, { method: 'DELETE', headers: { cookie: reader.cookie } });
  assert.equal(deleted.status, 403);
  const listed = await fetch(`${base}/api/sites`, { headers: { cookie: reader.cookie } });
  assert.equal(listed.status, 200);
});

test('privileged site delete requires re-auth and writes an audit row', async () => {
  const owner = await login({ password });
  const site = await (await fetch(`${base}/api/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: owner.cookie },
    body: JSON.stringify({ repo: 'git@github.com:example/reauth-site.git', name: 'Reauth Site', type: 'static' }),
  })).json();
  const denied = await fetch(`${base}/api/sites/${site.slug}`, { method: 'DELETE', headers: { cookie: owner.cookie } });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).reauth_required, true);
  const reauth = await fetch(`${base}/api/reauth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: owner.cookie },
    body: JSON.stringify({ password }),
  });
  assert.equal(reauth.status, 200);
  const deleted = await fetch(`${base}/api/sites/${site.slug}`, { method: 'DELETE', headers: { cookie: owner.cookie } });
  assert.equal(deleted.status, 204);
  const audit = await (await fetch(`${base}/api/audit?action=Site%20deleted`, { headers: { cookie: owner.cookie } })).json();
  assert.ok(audit.items.some((item) => item.target === 'Reauth Site' && item.user_id));
});

test('panel self-update requires re-authentication', async () => {
  const owner = await login({ password });
  const denied = await fetch(`${base}/api/system/update`, { method: 'POST', headers: { cookie: owner.cookie } });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).reauth_required, true);
});

test('2FA enrollment is required on login and lockout trips after five failures', async () => {
  const owner = await login({ password });
  const created = await fetch(`${base}/api/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: owner.cookie },
    body: JSON.stringify({ email: 'twofa', name: 'Two Factor', role: 'operator', password: 'twofactor1' }),
  });
  assert.equal(created.status, 201);
  const member = await login({ email: 'twofa', password: 'twofactor1' });
  assert.equal(member.response.status, 200);
  const begin = await fetch(`${base}/api/account/2fa/begin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: member.cookie },
    body: '{}',
  });
  assert.equal(begin.status, 200);
  const enrollment = await begin.json();
  const confirm = await fetch(`${base}/api/account/2fa/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: member.cookie },
    body: JSON.stringify({ code: totp.totp(enrollment.secret) }),
  });
  assert.equal(confirm.status, 200);
  await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie: member.cookie } });
  const missing = await login({ email: 'twofa', password: 'twofactor1' });
  assert.equal(missing.response.status, 401);
  assert.equal(missing.payload.totp_required, true);
  const ok = await login({ email: 'twofa', password: 'twofactor1', totp: totp.totp(enrollment.secret) });
  assert.equal(ok.response.status, 200);
  await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie: ok.cookie } });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await login({ email: 'twofa', password: 'twofactor1', totp: '000000' });
  }
  const locked = await login({ email: 'twofa', password: 'twofactor1', totp: '000000' });
  assert.equal(locked.response.status, 429);
  assert.equal(locked.payload.totp_locked, true);
});
