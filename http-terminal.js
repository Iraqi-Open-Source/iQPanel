const path = require('node:path');
const { send, body, log, getSite } = require('./http-shared');
const terminal = require('./terminal');
const { resolveRunAsUser } = require('./site-user');
const { root } = require('./db');

const sitesRoot = process.env.PANEL_SITES_ROOT || path.join(root, 'sites');

function siteAppPath(slug) {
  return path.join(sitesRoot, slug, 'app');
}

function constrainCwd(site, requested, escalate) {
  const fallback = siteAppPath(site.slug);
  if (escalate && requested && path.isAbsolute(requested)) return requested;
  if (!requested) return fallback;
  const resolved = path.resolve(fallback, requested);
  const base = fallback;
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new Error('Working directory escapes site root');
  return resolved;
}

async function handleTerminal(request, response, pathname) {
  if (request.method === 'POST' && pathname === '/api/terminal') {
    const input = await body(request).catch(() => ({}));
    const site = input.site_slug ? getSite(input.site_slug) : null;
    if (input.site_slug && !site) throw new Error('Site not found');
    const escalate = Boolean(input.escalate);
    const user = site
      ? resolveRunAsUser({ site, requested: input.user, escalate })
      : (escalate ? resolveRunAsUser({ site: null, requested: input.user || 'root', escalate: true }) : null);
    const cwd = site
      ? constrainCwd(site, input.cwd, escalate)
      : (input.cwd && path.isAbsolute(input.cwd) ? input.cwd : process.cwd());
    const session = terminal.createSession({
      cwd,
      user,
      command: input.command,
      args: input.args,
    });
    log('Terminal session started', session.id, user ? `user ${user}` : 'panel user');
    send(response, 201, { ...session, user: user || null, cwd, site_slug: site?.slug || null });
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
    let previousClosed = false;
    const push = () => {
      const session = terminal.get(sessionId);
      const text = terminal.read(sessionId);
      const closed = Boolean(session?.closed);
      if (text !== previous || closed !== previousClosed) {
        const chunk = text.startsWith(previous) ? text.slice(previous.length) : text;
        previous = text;
        previousClosed = closed;
        response.write(`data: ${JSON.stringify({ chunk, closed })}\n\n`);
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
