const { send, body, log, now, id, db, secrets } = require('./http-shared');
const { localServer, publicServer, listServers } = require('./servers');
const { probeServer } = require('./server-probe');

async function handleServers(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/servers') {
    send(response, 200, listServers());
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
    const status = await probeServer(row.id).catch(() => 'unknown');
    send(response, 201, { ...publicServer(row), status });
    return true;
  }
  const probeMatch = pathname.match(/^\/api\/servers\/([^/]+)\/probe$/);
  if (probeMatch && request.method === 'POST') {
    if (probeMatch[1] === 'local') {
      const status = await probeServer('local');
      send(response, 200, { ...localServer(), status });
      return true;
    }
    const row = db.rows(`SELECT * FROM servers WHERE id=${db.sql(probeMatch[1])}`)[0];
    if (!row) { send(response, 404, { error: 'Server not found' }); return true; }
    const status = await probeServer(row.id);
    const updated = db.rows(`SELECT * FROM servers WHERE id=${db.sql(row.id)}`)[0];
    send(response, 200, { ...publicServer(updated), status });
    return true;
  }
  const match = pathname.match(/^\/api\/servers\/([^/]+)$/);
  if (match && request.method === 'DELETE') {
    if (match[1] === 'local') throw new Error('Cannot delete the local server');
    const bound = db.rows(`SELECT slug FROM sites WHERE server_id=${db.sql(match[1])} LIMIT 1`)[0];
    if (bound) throw new Error(`Server still has sites (for example ${bound.slug})`);
    db.run(`DELETE FROM servers WHERE id=${db.sql(match[1])}`);
    log('Server removed', match[1]);
    send(response, 204, {});
    return true;
  }
  return false;
}

module.exports = { handleServers, publicServer, localServer };
