const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-client-'));
const socketPath = path.join(dataRoot, 'agent.sock');
const token = 'socket-test-token';

test('invokes allow-listed Agent actions over the Unix socket', async (t) => {
  const daemon = spawn(process.execPath, ['agent-daemon.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PANEL_DATA_ROOT: dataRoot,
      PANEL_SITES_ROOT: path.join(dataRoot, 'sites'),
      PANEL_AGENT_SOCKET: socketPath,
      PANEL_AGENT_TOKEN: token,
    },
    stdio: 'ignore',
  });
  t.after(() => daemon.kill());
  await waitFor(() => fs.existsSync(socketPath));
  process.env.PANEL_AGENT_SOCKET = socketPath;
  process.env.PANEL_AGENT_TOKEN = token;
  process.env.PANEL_DATA_ROOT = dataRoot;
  process.env.PANEL_SITES_ROOT = path.join(dataRoot, 'sites');
  delete require.cache[require.resolve('../agent-client')];
  const agentClient = require('../agent-client');
  const result = await agentClient.invoke('createSite', 'socket-site');
  assert.match(result.publicKey, /^ssh-ed25519 /);
  assert.ok(fs.existsSync(path.join(dataRoot, 'sites', 'socket-site', '.ssh', 'id_ed25519')));
});

async function waitFor(check) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for Agent socket');
}
