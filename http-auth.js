const { send, body, sessions, loginAttempts, log, crypto, secrets } = require('./http-shared');

function cookieMap(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => part.trim().split('=')).filter((item) => item[0]));
}

function clientIp(request) {
  return request.socket.remoteAddress || 'unknown';
}

function rateLimited(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.reset) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= 5;
}

function recordLoginFailure(ip) {
  const current = loginAttempts.get(ip);
  if (!current || Date.now() > current.reset) {
    loginAttempts.set(ip, { count: 1, reset: Date.now() + 15 * 60 * 1000 });
    return;
  }
  current.count += 1;
}

function authRequired() {
  return Boolean(process.env.PANEL_ADMIN_PASSWORD_HASH);
}

function sessionUser(request) {
  const token = cookieMap(request).iqpanel_session;
  const session = token ? sessions.get(token) : null;
  if (!session || session.expires < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return session;
}

function secureCookie(request) {
  const forwarded = String(request.headers['x-forwarded-proto'] || '').includes('https');
  const secure = forwarded || request.socket?.encrypted;
  return secure ? '; Secure' : '';
}

async function handleAuth(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/session') {
    if (authRequired() && !sessionUser(request)) {
      send(response, 401, { authenticated: false });
      return true;
    }
    send(response, 200, { authenticated: true, auth_required: authRequired() });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/login') {
    const ip = clientIp(request);
    if (rateLimited(ip)) {
      send(response, 429, { error: 'Too many login attempts' });
      return true;
    }
    const input = await body(request);
    if (!authRequired() || secrets.verifyPassword(input.password, process.env.PANEL_ADMIN_PASSWORD_HASH)) {
      const token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, { expires: Date.now() + 12 * 60 * 60 * 1000 });
      log('Admin signed in', 'panel');
      send(response, 200, { ok: true }, { 'set-cookie': `iqpanel_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secureCookie(request)}` });
      return true;
    }
    recordLoginFailure(ip);
    send(response, 401, { error: 'Invalid credentials' });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/logout') {
    const token = cookieMap(request).iqpanel_session;
    if (token) sessions.delete(token);
    send(response, 200, { ok: true }, { 'set-cookie': `iqpanel_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie(request)}` });
    return true;
  }
  if (authRequired() && !sessionUser(request) && pathname.startsWith('/api/') && !pathname.startsWith('/api/webhooks/')) {
    send(response, 401, { error: 'Authentication required' });
    return true;
  }
  return false;
}

module.exports = { handleAuth, authRequired, sessionUser };
