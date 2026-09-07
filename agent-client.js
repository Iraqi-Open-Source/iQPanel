const net = require('node:net');
const fs = require('node:fs');
const agent = require('./ops');
const { connectionFor, markServerStatus } = require('./servers');

function transportInvoke(connection, action, args) {
  if (connection.type === 'inline') {
    if (typeof agent[action] !== 'function') throw new Error('Unsupported Agent action');
    return Promise.resolve(agent[action](...args));
  }
  if (connection.type === 'socket') {
    if (!fs.existsSync(connection.socketPath)) throw new Error('Agent socket unavailable');
    return socketInvoke(connection.socketPath, connection.token, action, args);
  }
  return tcpInvoke(connection.host, connection.port, connection.token, action, args);
}

function invokeOn(serverId, action, args) {
  const connection = connectionFor(serverId);
  return transportInvoke(connection, action, args).then((result) => {
    if (serverId && serverId !== 'local') markServerStatus(serverId, 'online');
    return result;
  }).catch((error) => {
    if (serverId && serverId !== 'local') markServerStatus(serverId, 'offline');
    throw error;
  });
}

function invoke(action, ...args) {
  return invokeOn('local', action, args);
}

function forServer(serverId = 'local') {
  return {
    invoke(action, ...args) {
      return invokeOn(serverId || 'local', action, args);
    },
  };
}

function socketInvoke(socketPath, token, action, args) {
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
      socket.write(`${JSON.stringify({ token, action, args })}\n`);
    });
  });
}

function tcpInvoke(host, port, token, action, args) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host);
    let data = '';
    socket.setTimeout(15000, () => {
      socket.destroy();
      reject(new Error('Remote Agent connection timed out'));
    });
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
      socket.write(`${JSON.stringify({ token, action, args })}\n`);
    });
  });
}

module.exports = { invoke, forServer, invokeOn, transportInvoke };
