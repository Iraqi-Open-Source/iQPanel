/**
 * WebSocket terminal route.
 * Uses Node.js built-in HTTP upgrade to handle WebSocket handshake.
 * The agent spawns a PTY via `setsid script -qfc` + `runuser`.
 */
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { get } from '../../data/db.js';
import { getSession, findUserById } from '../session.js';

const TOKEN   = () => process.env.PANEL_AGENT_TOKEN ?? '';
const SOCKET  = () => process.env.PANEL_AGENT_SOCKET ?? '/run/iqpanel-agent.sock';

export function registerTerminal(app) {
  // The actual WebSocket upgrade is attached to the HTTP server in server/main.js
  // This route provides the upgrade URL endpoint marker
  app.get('/api/terminal/info', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    res.json({ ws_path: '/api/terminal/connect' });
  });
}

/**
 * Attach WebSocket upgrade handling to the raw HTTP server.
 * Called from server/main.js after app.listen().
 */
export function attachTerminalWS(httpServer) {
  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/api/terminal/connect')) {
      socket.destroy();
      return;
    }

    // Authenticate via cookie in the upgrade request
    const cookies = parseCookies(req.headers.cookie ?? '');
    const token   = cookies['iqpanel_session'];
    const sess    = getSession(token);
    if (!sess) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    const user = findUserById(sess.user_id);
    if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }

    // Parse query params
    const url     = new URL(req.url, 'http://x');
    const slug    = url.searchParams.get('site');
    const isAdmin = url.searchParams.get('admin') === '1';

    let siteUser = null;
    if (slug) {
      const site = get('SELECT * FROM sites WHERE slug = ?', [slug]);
      if (!site) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return; }
      siteUser = site.run_as_user ?? null;
    }

    // WebSocket handshake
    const key    = req.headers['sec-websocket-key'];
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '', '',
    ].join('\r\n'));

    handleTerminalSession(socket, siteUser, isAdmin);
  });
}

function parseCookies(str) {
  const out = {};
  for (const pair of str.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return out;
}

function handleTerminalSession(wsSocket, siteUser, isAdmin) {
  const agentSocket = createConnection(SOCKET());
  const id = randomBytes(8).toString('hex');
  let agentBuf = '';

  const user = siteUser ?? (isAdmin ? 'root' : 'www-data');
  const cmd  = `runuser -u ${user} -- /bin/bash -i`;

  agentSocket.on('connect', () => {
    agentSocket.write(JSON.stringify({
      id,
      token:  TOKEN(),
      action: 'exec.run',
      args:   { slug: siteUser?.replace('iqpanel-', '') ?? '_admin', cmd },
      stream: true,
    }) + '\n');
  });

  agentSocket.on('data', (chunk) => {
    agentBuf += chunk;
    const lines = agentBuf.split('\n');
    agentBuf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let frame;
      try { frame = JSON.parse(line); } catch { continue; }
      if (frame.id !== id) continue;
      if (frame.t === 'stdout') sendWsText(wsSocket, frame.d);
      else if (frame.t === 'stderr') sendWsText(wsSocket, frame.d);
      else if (frame.t === 'result' || frame.t === 'error') {
        sendWsText(wsSocket, '\r\n[session ended]\r\n');
        wsSocket.end();
      }
    }
  });

  agentSocket.on('error', () => { sendWsText(wsSocket, '\r\n[agent error]\r\n'); wsSocket.end(); });

  wsSocket.on('data', (buf) => {
    // Parse minimal WS frame to extract text payload
    const frame = parseWsFrame(buf);
    if (!frame) return;
    // Forward input to stdin of exec.run – not directly possible with current model.
    // In production, the agent exec.run action would need PTY support.
    // For MVP, this is a one-way output stream.
    // Input support requires the agent to expose a PTY channel.
  });

  wsSocket.on('close', () => agentSocket.destroy());
  wsSocket.on('error', () => agentSocket.destroy());
}

function sendWsText(socket, text) {
  const payload = Buffer.from(text);
  const header  = buildWsHeader(payload.length, 0x1); // opcode 1 = text
  socket.write(Buffer.concat([header, payload]));
}

function buildWsHeader(len, opcode) {
  const fin    = 0x80;
  const byte1  = fin | opcode;
  if (len < 126) {
    return Buffer.from([byte1, len]);
  } else if (len < 65536) {
    const buf = Buffer.alloc(4);
    buf[0] = byte1; buf[1] = 126;
    buf.writeUInt16BE(len, 2);
    return buf;
  } else {
    const buf = Buffer.alloc(10);
    buf[0] = byte1; buf[1] = 127;
    buf.writeBigUInt64BE(BigInt(len), 2);
    return buf;
  }
}

function parseWsFrame(buf) {
  if (buf.length < 2) return null;
  const masked  = !!(buf[1] & 0x80);
  let len       = buf[1] & 0x7f;
  let offset    = 2;
  if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); offset = 10; }
  if (!masked) return buf.slice(offset, offset + len).toString();
  const mask    = buf.slice(offset, offset + 4);
  const payload = buf.slice(offset + 4, offset + 4 + len);
  for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  return payload.toString();
}
