const db = require('./db');
const secrets = require('./secrets');

function localServer() {
  return {
    id: 'local',
    name: 'Local agent',
    host: '127.0.0.1',
    port: Number(process.env.PANEL_AGENT_LISTEN_PORT || 4174),
    kind: 'local',
    status: 'online',
  };
}

function publicServer(row) {
  if (!row) return row;
  const clone = { ...row };
  delete clone.token;
  delete clone.token_ciphertext;
  return clone;
}

function listServers() {
  return [localServer(), ...db.rows('SELECT * FROM servers ORDER BY created_at DESC').map(publicServer)];
}

function getServerRecord(serverId) {
  if (!serverId || serverId === 'local') {
    return {
      ...localServer(),
      token: process.env.PANEL_AGENT_TOKEN || '',
    };
  }
  const row = db.rows(`SELECT * FROM servers WHERE id=${db.sql(serverId)}`)[0];
  if (!row) throw new Error('Server not found');
  return {
    ...row,
    token: row.token_ciphertext ? secrets.decrypt(row.token_ciphertext) : '',
  };
}

function resolveServerId(serverId) {
  const value = String(serverId || 'local').trim() || 'local';
  if (value === 'local') return 'local';
  if (!db.rows(`SELECT id FROM servers WHERE id=${db.sql(value)}`)[0]) throw new Error('Unknown server');
  return value;
}

function connectionFor(serverId) {
  const record = getServerRecord(serverId);
  if (record.id === 'local') {
    const socketPath = process.env.PANEL_AGENT_SOCKET;
    if (socketPath) return { type: 'socket', socketPath, token: record.token };
    return { type: 'inline' };
  }
  return { type: 'tcp', host: record.host, port: record.port, token: record.token };
}

function markServerStatus(serverId, status) {
  if (!serverId || serverId === 'local') return;
  db.run(`UPDATE servers SET status=${db.sql(status)}, last_probed_at=${db.sql(new Date().toISOString())} WHERE id=${db.sql(serverId)}`);
}

module.exports = {
  localServer,
  publicServer,
  listServers,
  getServerRecord,
  resolveServerId,
  connectionFor,
  markServerStatus,
};
