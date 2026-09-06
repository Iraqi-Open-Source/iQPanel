const { send, body, getSite, log, now, id, db, secrets, agentClient } = require('./http-shared');

function publicServer(row) {
  if (!row) return row;
  const clone = { ...row };
  delete clone.token;
  delete clone.token_ciphertext;
  return clone;
}

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

async function handleServers(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/servers') {
    send(response, 200, [localServer(), ...db.rows('SELECT * FROM servers ORDER BY created_at DESC').map(publicServer)]);
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/servers') {
    const input = await body(request);
    const name = String(input.name || '').trim();
    const host = String(input.host || '').trim();
    const port = Number(input.port || 4174);
    if (!name || !/^[A-Za-z0-9.-]+$/.test(host)) throw new Error('Invalid server details');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server port');
    const row = { id: id(), name, host, port, kind: 'remote', status: 'unknown', created_at: now() };
    const cipher = secrets.encrypt(String(input.token || ''));
    db.run(`INSERT INTO servers (id,name,host,port,token_ciphertext,kind,status,created_at) VALUES (${db.sql(row.id)},${db.sql(row.name)},${db.sql(row.host)},${row.port},${db.sql(cipher)},'remote','unknown',${db.sql(row.created_at)})`);
    log('Server registered', name, host);
    send(response, 201, publicServer(row));
    return true;
  }
  const match = pathname.match(/^\/api\/servers\/([^/]+)$/);
  if (match && request.method === 'DELETE') {
    if (match[1] === 'local') throw new Error('Cannot delete the local server');
    db.run(`DELETE FROM servers WHERE id=${db.sql(match[1])}`);
    log('Server removed', match[1]);
    send(response, 204, {});
    return true;
  }
  return false;
}

module.exports = { handleServers, publicServer, localServer };
