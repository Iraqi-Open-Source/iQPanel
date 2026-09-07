const db = require('./db');
const agentClient = require('./agent-client');
const { markServerStatus } = require('./servers');

async function probeServer(serverId) {
  if (!serverId || serverId === 'local') {
    try {
      await agentClient.invoke('ping');
      return 'online';
    } catch {
      return 'offline';
    }
  }
  try {
    await agentClient.forServer(serverId).invoke('ping');
    markServerStatus(serverId, 'online');
    return 'online';
  } catch {
    markServerStatus(serverId, 'offline');
    return 'offline';
  }
}

async function probeAll() {
  const remote = db.rows('SELECT id FROM servers');
  for (const row of remote) {
    await probeServer(row.id).catch(() => {});
  }
}

function start(intervalMs = 60000) {
  probeAll().catch(() => {});
  return setInterval(() => { probeAll().catch(() => {}); }, intervalMs);
}

module.exports = { probeServer, probeAll, start };
