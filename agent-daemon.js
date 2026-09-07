const net = require('node:net');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const actions = require('./ops');
const { attachAgentProtocol } = require('./agent-protocol');

const socketPath = process.env.PANEL_AGENT_SOCKET || '/tmp/iqpanel-agent.sock';
const expectedToken = process.env.PANEL_AGENT_TOKEN;
const listenPort = Number(process.env.PANEL_AGENT_LISTEN_PORT || 0);
const listenHost = process.env.PANEL_AGENT_LISTEN_HOST || '0.0.0.0';

if (!expectedToken) {
  console.error('PANEL_AGENT_TOKEN is required before the Agent can listen.');
  process.exit(1);
}

function bindUnixSocket() {
  try { fs.unlinkSync(socketPath); } catch {}
  const server = net.createServer((connection) => {
    attachAgentProtocol(connection, actions, expectedToken);
  });
  server.listen(socketPath, () => {
    fs.chmodSync(socketPath, 0o660);
    try {
      const gid = Number(execFileSync('id', ['-g', 'panel'], { encoding: 'utf8' }).trim());
      fs.chownSync(socketPath, 0, gid);
    } catch {}
    console.log(`iQPanel Agent listening on ${socketPath}`);
  });
}

function bindTcpListener() {
  if (!listenPort) return;
  const server = net.createServer((connection) => {
    attachAgentProtocol(connection, actions, expectedToken);
  });
  server.listen(listenPort, listenHost, () => {
    console.log(`iQPanel Agent TCP listening on ${listenHost}:${listenPort}`);
  });
}

bindUnixSocket();
bindTcpListener();
