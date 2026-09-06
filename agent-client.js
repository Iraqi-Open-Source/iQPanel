const net = require('node:net');
const fs = require('node:fs');
const agent = require('./agent-ops');

function invoke(action, ...args) {
  const socketPath = process.env.PANEL_AGENT_SOCKET;
  if (socketPath) {
    if (!fs.existsSync(socketPath)) throw new Error('Agent socket unavailable');
    return socketInvoke(socketPath, action, args);
  }
  if (typeof agent[action] !== 'function') throw new Error('Unsupported Agent action');
  return agent[action](...args);
}

function socketInvoke(socketPath, action, args) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    let data = '';
    socket.on('error', reject);
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (!parsed.ok) reject(new Error(parsed.error || 'Agent action failed'));
        else resolve(parsed.result);
      } catch (error) {
        reject(error);
      }
    });
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ token: process.env.PANEL_AGENT_TOKEN || '', action, args })}\n`);
    });
  });
}

module.exports = { invoke };
