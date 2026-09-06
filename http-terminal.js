const path = require('node:path');
const { send, body, log } = require('./http-shared');
const terminal = require('./terminal');

async function handleTerminal(request, response, pathname) {
  if (request.method === 'POST' && pathname === '/api/terminal') {
    const input = await body(request).catch(() => ({}));
    const session = terminal.createSession({
      cwd: input.cwd && path.isAbsolute(input.cwd) ? input.cwd : process.cwd(),
    });
    log('Terminal session started', session.id);
    send(response, 201, session);
    return true;
  }
  const match = pathname.match(/^\/api\/terminal\/([^/]+)(?:\/(input|stream))?$/);
  if (!match) return false;
  const sessionId = match[1];
  if (request.method === 'GET' && !match[2]) {
    send(response, 200, terminal.snapshot(sessionId));
    return true;
  }
  if (request.method === 'GET' && match[2] === 'stream') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    let previous = '';
    const push = () => {
      const text = terminal.read(sessionId);
      if (text !== previous) {
        const chunk = text.startsWith(previous) ? text.slice(previous.length) : text;
        previous = text;
        response.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }
    };
    push();
    const timer = setInterval(push, 250);
    request.on('close', () => clearInterval(timer));
    return true;
  }
  if (request.method === 'POST' && match[2] === 'input') {
    const input = await body(request);
    terminal.write(sessionId, input.data || '');
    send(response, 200, { ok: true });
    return true;
  }
  if (request.method === 'DELETE' && !match[2]) {
    terminal.close(sessionId);
    log('Terminal session ended', sessionId);
    send(response, 204, {});
    return true;
  }
  return false;
}

module.exports = { handleTerminal };
