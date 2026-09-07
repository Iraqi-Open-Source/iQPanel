const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const panelDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-phase3a-panel-'));
const remoteDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-phase3a-remote-'));
const remoteSitesRoot = path.join(remoteDataRoot, 'sites');
const remotePort = 4392;
const remoteToken = 'phase3a-remote-token';
const panelPort = 4393;
const panelBase = `http://127.0.0.1:${panelPort}`;

const remoteAgent = spawn(process.execPath, ['agent-daemon.js'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    PANEL_DATA_ROOT: remoteDataRoot,
    PANEL_SITES_ROOT: remoteSitesRoot,
    PANEL_AGENT_SOCKET: path.join(remoteDataRoot, 'agent.sock'),
    PANEL_AGENT_TOKEN: remoteToken,
    PANEL_AGENT_LISTEN_PORT: String(remotePort),
    PANEL_AGENT_LISTEN_HOST: '127.0.0.1',
  },
  stdio: 'ignore',
});

const panel = spawn(process.execPath, ['app-http.js'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(panelPort),
    PANEL_DATA_ROOT: panelDataRoot,
    PANEL_SITES_ROOT: path.join(panelDataRoot, 'sites'),
    PANEL_SECRET_KEY: 'phase3a-panel-secret',
  },
  stdio: 'ignore',
});

test.after(() => {
  remoteAgent.kill();
  panel.kill();
});

async function waitFor(check, message = 'condition') {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

test('routes site creation to a remote Agent over TCP', async () => {
  await waitFor(async () => {
    try {
      const response = await fetch(`${panelBase}/api/dashboard`);
      return response.ok;
    } catch {
      return false;
    }
  }, 'panel API');

  await waitFor(() => new Promise((resolve) => {
    const net = require('node:net');
    const socket = net.connect(remotePort, '127.0.0.1', () => { socket.end(); resolve(true); });
    socket.on('error', () => resolve(false));
  }), 'remote agent TCP');

  const createdServer = await fetch(`${panelBase}/api/servers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Remote Node', host: '127.0.0.1', port: remotePort, token: remoteToken }),
  });
  assert.equal(createdServer.status, 201);
  const serverRow = await createdServer.json();
  assert.equal(serverRow.status, 'online');

  const siteResponse = await fetch(`${panelBase}/api/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      repo: 'git@github.com:example/remote-app.git',
      name: 'Remote App',
      type: 'static',
      server_id: serverRow.id,
    }),
  });
  assert.equal(siteResponse.status, 201);
  const site = await siteResponse.json();
  assert.equal(site.server_id, serverRow.id);
  assert.ok(fs.existsSync(path.join(remoteSitesRoot, site.slug, '.ssh', 'id_ed25519')));
  assert.equal(fs.existsSync(path.join(panelDataRoot, 'sites', site.slug, '.ssh', 'id_ed25519')), false);
});

test('marks remote servers offline when the Agent token is invalid', async () => {
  const created = await fetch(`${panelBase}/api/servers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Bad Token', host: '127.0.0.1', port: remotePort, token: 'wrong-token' }),
  });
  assert.equal(created.status, 201);
  const serverRow = await created.json();
  assert.equal(serverRow.status, 'offline');

  const probed = await fetch(`${panelBase}/api/servers/${serverRow.id}/probe`, { method: 'POST', body: '{}' });
  assert.equal(probed.status, 200);
  const body = await probed.json();
  assert.equal(body.status, 'offline');
});

test('local site creation still uses the inline local Agent', async () => {
  const siteResponse = await fetch(`${panelBase}/api/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      repo: 'git@github.com:example/local-app.git',
      name: 'Local App',
      type: 'static',
    }),
  });
  assert.equal(siteResponse.status, 201);
  const site = await siteResponse.json();
  assert.equal(site.server_id, 'local');
  assert.ok(fs.existsSync(path.join(panelDataRoot, 'sites', site.slug, '.ssh', 'id_ed25519')));
});

test('agent client still supports Unix socket invoke for local daemon', async (t) => {
  const socketPath = path.join(panelDataRoot, 'local-agent.sock');
  const token = 'local-socket-token';
  const daemon = spawn(process.execPath, ['agent-daemon.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PANEL_DATA_ROOT: panelDataRoot,
      PANEL_SITES_ROOT: path.join(panelDataRoot, 'sites'),
      PANEL_AGENT_SOCKET: socketPath,
      PANEL_AGENT_TOKEN: token,
      PANEL_AGENT_LISTEN_PORT: '',
    },
    stdio: 'ignore',
  });
  t.after(() => daemon.kill());
  await waitFor(() => fs.existsSync(socketPath), 'local agent socket');
  process.env.PANEL_AGENT_SOCKET = socketPath;
  process.env.PANEL_AGENT_TOKEN = token;
  delete require.cache[require.resolve('../agent-client')];
  const agentClient = require('../agent-client');
  const result = await agentClient.invoke('ping');
  assert.equal(result.ok, true);
});
