const { send, body, sessions, loginAttempts, log, crypto, secrets, currentUser, currentSession, httpError } = require('./http-shared');
const users = require('./users');
const totp = require('./totp');

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
  users.ensureOwnerMigration();
  return Boolean(process.env.PANEL_ADMIN_PASSWORD_HASH) || dbHasUsers();
}

function dbHasUsers() {
  return users.listUsers().length > 0;
}

function sessionRecord(request) {
  const token = cookieMap(request).iqpanel_session;
  const session = token ? sessions.get(token) : null;
  if (!session || session.expires < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return session;
}

function sessionUser(request) {
  const session = sessionRecord(request);
  if (!session) return null;
  if (session.userId) {
    const row = users.getUser(session.userId);
    if (!row) return null;
    return { ...users.publicUser(row), reauthUntil: session.reauthUntil || 0 };
  }
  return { id: null, email: 'admin', name: 'Administrator', role: 'owner', totp_enabled: false, reauthUntil: session.reauthUntil || 0 };
}

function hasReauth(session) {
  return Boolean(session && session.reauthUntil && session.reauthUntil > Date.now());
}

function needsReauth(method, pathname) {
  if (method === 'POST' && pathname === '/api/terminal') return true;
  if (method === 'DELETE' && /^\/api\/sites\/[^/]+$/.test(pathname)) return true;
  if (method === 'POST' && /\/firewall$/.test(pathname)) return true;
  if (method === 'POST' && pathname === '/api/system/migrate-site-users') return true;
  if (method === 'POST' && pathname === '/api/system/update') return true;
  if (method === 'POST' && pathname === '/api/system/packages/install') return true;
  if (method === 'POST' && pathname === '/api/system/php/install') return true;
  if (method === 'POST' && /^\/api\/system\/services\/[^/]+\/(start|stop|restart|enable|disable)$/.test(pathname)) return true;
  if (['POST', 'PUT', 'DELETE'].includes(method) && /^\/api\/system\/(openlitespeed|fail2ban|swap|disk|ssh-keys|mail|phpmyadmin|cloudflare)/.test(pathname)) return true;
  if (method === 'DELETE' && /^\/api\/users\/[^/]+$/.test(pathname)) return true;
  return false;
}

function authorizeRequest(request, pathname) {
  if (!authRequired()) return;
  const user = currentUser();
  if (!user) return;
  const method = request.method;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return;
  if (pathname === '/api/logout' || pathname === '/api/reauth') return;
  if (pathname.startsWith('/api/account/')) return;
  if (user.role === 'readonly') httpError(403, 'Read-only users cannot perform this action');
  if (pathname.startsWith('/api/users') && !['owner', 'admin'].includes(user.role)) {
    httpError(403, 'Insufficient role');
  }
  if (needsReauth(method, pathname) && !hasReauth(currentSession())) {
    httpError(403, 'Re-authentication required', { reauth_required: true });
  }
}

function secureCookie(request) {
  const forwarded = String(request.headers['x-forwarded-proto'] || '').includes('https');
  const secure = forwarded || request.socket?.encrypted;
  return secure ? '; Secure' : '';
}

function issueSession(response, request, user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, {
    expires: Date.now() + 12 * 60 * 60 * 1000,
    userId: user?.id || null,
    reauthUntil: 0,
  });
  send(response, 200, { ok: true, user: user ? users.publicUser(user) : { role: 'owner' } }, {
    'set-cookie': `iqpanel_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secureCookie(request)}`,
  });
}

function verifyUserPassword(user, password) {
  if (user) return secrets.verifyPassword(password, user.password_hash);
  return Boolean(process.env.PANEL_ADMIN_PASSWORD_HASH) && secrets.verifyPassword(password, process.env.PANEL_ADMIN_PASSWORD_HASH);
}

function completeLogin(user, input) {
  if (!user?.totp_enabled) return { ok: true };
  if (users.isLocked(user)) {
    httpError(429, 'Two-factor authentication is locked', { totp_locked: true, locked_until: user.locked_until });
  }
  const code = String(input.totp || input.code || '').trim();
  const backup = String(input.backup_code || '').trim();
  if (!code && !backup) httpError(401, 'Two-factor code required', { totp_required: true });
  const secret = users.totpSecret(user);
  const valid = (code && totp.verifyTotp(secret, code)) || (backup && users.consumeBackupCode(user, backup));
  if (!valid) {
    const failure = users.record2faFailure(user);
    if (failure.locked) httpError(429, 'Two-factor authentication is locked', { totp_locked: true, locked_until: failure.locked });
    httpError(401, 'Invalid two-factor code', { totp_required: true });
  }
  users.clear2faFailures(user);
  return { ok: true };
}

async function handleAuth(request, response, pathname) {
  users.ensureOwnerMigration();
  if (request.method === 'GET' && pathname === '/api/session') {
    if (authRequired() && !sessionUser(request)) {
      send(response, 401, { authenticated: false, auth_required: true });
      return true;
    }
    const user = sessionUser(request);
    send(response, 200, {
      authenticated: true,
      auth_required: authRequired(),
      user,
      reauth_valid: hasReauth(sessionRecord(request)),
    });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/login') {
    const ip = clientIp(request);
    if (rateLimited(ip)) {
      send(response, 429, { error: 'Too many login attempts' });
      return true;
    }
    const input = await body(request);
    if (!authRequired()) {
      issueSession(response, request, null);
      return true;
    }
    const identifier = String(input.email || input.username || 'admin').trim();
    const user = users.findUserByEmail(identifier);
    const password = String(input.password || '');
    if (!verifyUserPassword(user, password)) {
      recordLoginFailure(ip);
      send(response, 401, { error: 'Invalid credentials' });
      return true;
    }
    try {
      completeLogin(user, input);
    } catch (error) {
      if (error.statusCode === 401 && error.payload?.totp_required && !input.totp && !input.backup_code && !input.code) {
        send(response, error.statusCode, error.payload);
        return true;
      }
      if (error.statusCode) {
        send(response, error.statusCode, error.payload || { error: error.message });
        return true;
      }
      throw error;
    }
    log('Admin signed in', user?.email || 'panel', '', user?.id);
    issueSession(response, request, user);
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/logout') {
    const token = cookieMap(request).iqpanel_session;
    if (token) sessions.delete(token);
    send(response, 200, { ok: true }, { 'set-cookie': `iqpanel_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie(request)}` });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/reauth') {
    const session = sessionRecord(request);
    const user = sessionUser(request);
    if (authRequired() && (!session || !user)) {
      send(response, 401, { error: 'Authentication required' });
      return true;
    }
    const input = await body(request);
    const row = user?.id ? users.getUser(user.id) : null;
    if (authRequired() && !verifyUserPassword(row, String(input.password || ''))) {
      send(response, 401, { error: 'Invalid credentials' });
      return true;
    }
    if (row?.totp_enabled) completeLogin(row, input);
    session.reauthUntil = Date.now() + 10 * 60 * 1000;
    log('Re-authenticated', user?.email || 'panel');
    send(response, 200, { ok: true, reauth_until: new Date(session.reauthUntil).toISOString() });
    return true;
  }
  if (authRequired() && !sessionUser(request) && pathname.startsWith('/api/') && !pathname.startsWith('/api/webhooks/')) {
    send(response, 401, { error: 'Authentication required' });
    return true;
  }
  return false;
}

module.exports = { handleAuth, authRequired, sessionUser, sessionRecord, authorizeRequest, hasReauth };
