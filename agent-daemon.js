const net = require('node:net');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const actions = require('./ops');

const socketPath = process.env.PANEL_AGENT_SOCKET || '/tmp/iqpanel-agent.sock';
const expectedToken = process.env.PANEL_AGENT_TOKEN;
if (!expectedToken) {
  console.error('PANEL_AGENT_TOKEN is required before the Agent can listen.');
  process.exit(1);
}
try { fs.unlinkSync(socketPath); } catch {}

const server = net.createServer((connection) => {
  let input = '';
  const reply = (payload) => {
    connection.end(JSON.stringify(payload));
  };
  connection.on('data', async (chunk) => {
    input += chunk;
    if (!input.includes('\n') && input.length < 1e6) return;
    const raw = input.trim();
    input = '';
    try {
      const request = JSON.parse(raw);
      const provided = Buffer.from(String(request.token || ''));
      const expected = Buffer.from(expectedToken);
      if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) throw new Error('Unauthorized Agent client');
      if (typeof actions[request.action] !== 'function') throw new Error('Unsupported Agent action');
      const result = await actions[request.action](...(request.args || []));
      reply({ ok: true, result });
    } catch (error) {
      reply({ ok: false, error: error.message });
    }
  });
});

server.listen(socketPath, () => {
  fs.chmodSync(socketPath, 0o660);
  try {
    const gid = Number(execFileSync('id', ['-g', 'panel'], { encoding: 'utf8' }).trim());
    fs.chownSync(socketPath, 0, gid);
  } catch {}
  console.log(`iQPanel Agent listening on ${socketPath}`);
});
