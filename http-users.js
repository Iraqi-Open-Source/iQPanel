const { send, body, log, currentUser, httpError } = require('./http-shared');
const users = require('./users');
const totp = require('./totp');

function actor() {
  return currentUser();
}

function requireTeamAdmin() {
  const user = actor();
  if (!user) return;
  if (!['owner', 'admin'].includes(user.role)) httpError(403, 'Insufficient role');
}

async function handleUsers(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/users') {
    requireTeamAdmin();
    send(response, 200, users.listUsers());
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/users') {
    requireTeamAdmin();
    const created = users.createUser(await body(request), actor());
    log('User created', created.email, created.role);
    send(response, 201, created);
    return true;
  }
  const match = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (match && request.method === 'PATCH') {
    requireTeamAdmin();
    const updated = users.updateUser(match[1], await body(request), actor());
    log('User updated', updated.email, updated.role);
    send(response, 200, updated);
    return true;
  }
  if (match && request.method === 'DELETE') {
    requireTeamAdmin();
    const removed = users.deleteUser(match[1], actor());
    log('User deleted', match[1]);
    send(response, 200, removed);
    return true;
  }

  if (request.method === 'POST' && pathname === '/api/account/2fa/begin') {
    const user = actor();
    if (!user?.id) httpError(401, 'Authentication required');
    const secret = totp.generateSecret();
    const backupCodes = totp.generateBackupCodes();
    users.setTotp(user.id, { secret, enabled: false, backupCodes });
    log('Two-factor enrollment started', user.email);
    send(response, 200, {
      secret,
      otpauth_url: totp.otpauthUrl(user.email, secret),
      backup_codes: backupCodes,
    });
    return true;
  }
  if (request.method === 'POST' && pathname === '/api/account/2fa/confirm') {
    const user = actor();
    if (!user?.id) httpError(401, 'Authentication required');
    const row = users.getUser(user.id);
    const input = await body(request);
    const secret = users.totpSecret(row);
    if (!secret || !totp.verifyTotp(secret, input.code || input.totp)) httpError(401, 'Invalid two-factor code');
    users.setTotp(user.id, { secret, enabled: true });
    log('Two-factor enabled', user.email);
    send(response, 200, users.publicUser(users.getUser(user.id)));
    return true;
  }
  if (request.method === 'DELETE' && pathname === '/api/account/2fa') {
    const user = actor();
    if (!user?.id) httpError(401, 'Authentication required');
    const row = users.getUser(user.id);
    const input = await body(request).catch(() => ({}));
    const { secrets } = require('./http-shared');
    if (!secrets.verifyPassword(String(input.password || ''), row.password_hash)) httpError(401, 'Invalid credentials');
    users.setTotp(user.id, { secret: '', enabled: false, backupCodes: [] });
    log('Two-factor disabled', user.email);
    send(response, 200, { ok: true });
    return true;
  }
  return false;
}

module.exports = { handleUsers };
