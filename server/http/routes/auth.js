import { randomBytes } from 'node:crypto';
import {
  findUserByEmail, findUserById,
  verifyPassword, hashPassword,
  createSession, destroySession, refreshReauth,
  generateTotpSecret, verifyTotp,
  recordFailedLogin, clearFailedLogin, isLocked,
  csrfToken,
} from '../session.js';
import { query, get, run } from '../../data/db.js';
import { requireAuth } from '../middleware.js';
import { hasRole } from '../rbac.js';

function nowIso() { return new Date().toISOString(); }
function uuid()   { return randomBytes(16).toString('hex'); }

export function registerAuth(app) {
  // POST /api/auth/login
  app.post('/api/auth/login', (req, res) => {
    const { email, password, totp } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const user = findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (isLocked(user)) return res.status(429).json({ error: 'Account temporarily locked' });

    if (!verifyPassword(password, user.password_hash, user.password_salt)) {
      recordFailedLogin(user.id);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.totp_enabled) {
      if (!totp) return res.status(200).json({ totp_required: true });
      const secret = decryptField(user.totp_secret_enc);
      if (!verifyTotp(secret, totp)) {
        recordFailedLogin(user.id);
        return res.status(401).json({ error: 'Invalid 2FA code' });
      }
    }

    clearFailedLogin(user.id);
    const token = createSession(user.id);
    const csrf  = csrfToken(token);

    res.setCookie('iqpanel_session', token, { httpOnly: true, sameSite: 'Strict', maxAge: 43200 });
    res.json({
      ok:   true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      csrf,
    });
  });

  // POST /api/auth/logout
  app.post('/api/auth/logout', requireAuth, (req, res) => {
    destroySession(req.session.token);
    res.clearCookie('iqpanel_session');
    res.json({ ok: true });
  });

  // GET /api/auth/me
  app.get('/api/auth/me', requireAuth, (req, res) => {
    const u = req.user;
    res.json({
      id: u.id, email: u.email, name: u.name, role: u.role,
      totp_enabled: Boolean(u.totp_enabled),
      reauth_valid: req.reauthValid,
      csrf: csrfToken(req.session.token),
    });
  });

  // POST /api/auth/reauth  (provide password to get a re-auth window)
  app.post('/api/auth/reauth', requireAuth, (req, res) => {
    const { password } = req.body ?? {};
    const user = req.user;
    if (!verifyPassword(password, user.password_hash, user.password_salt)) {
      return res.status(401).json({ error: 'Incorrect password' });
    }
    refreshReauth(req.session.token);
    res.json({ ok: true });
  });

  // TOTP setup
  app.post('/api/auth/totp/setup', requireAuth, (req, res) => {
    const secret = generateTotpSecret();
    const enc    = encryptField(secret);
    run('UPDATE users SET totp_secret_enc = ?, totp_enabled = 0 WHERE id = ?', [enc, req.user.id]);
    const otpauth = `otpauth://totp/iQPanel:${encodeURIComponent(req.user.email)}?secret=${secret}&issuer=iQPanel`;
    res.json({ secret, otpauth });
  });

  app.post('/api/auth/totp/confirm', requireAuth, (req, res) => {
    const { code } = req.body ?? {};
    const user = findUserById(req.user.id);
    if (!user.totp_secret_enc) return res.status(400).json({ error: 'Setup not started' });
    const secret = decryptField(user.totp_secret_enc);
    if (!verifyTotp(secret, code)) return res.status(400).json({ error: 'Invalid code' });
    run('UPDATE users SET totp_enabled = 1 WHERE id = ?', [user.id]);
    res.json({ ok: true });
  });

  app.post('/api/auth/totp/disable', requireAuth, (req, res) => {
    if (!req.reauthValid) return res.status(403).json({ error: 'Re-authentication required', code: 'reauth' });
    run('UPDATE users SET totp_enabled = 0, totp_secret_enc = ? WHERE id = ?', ['', req.user.id]);
    res.json({ ok: true });
  });

  // Password change
  app.post('/api/auth/password', requireAuth, (req, res) => {
    const { current, next: nextPw } = req.body ?? {};
    const user = findUserById(req.user.id);
    if (!verifyPassword(current, user.password_hash, user.password_salt)) {
      return res.status(401).json({ error: 'Current password incorrect' });
    }
    if (!nextPw || nextPw.length < 8) return res.status(400).json({ error: 'Password too short' });
    const { hash, salt } = hashPassword(nextPw);
    run('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?', [hash, salt, user.id]);
    res.json({ ok: true });
  });
}

// ──────────────────────────────────────────────────
// Encryption helpers (stub – real impl in secrets.js)
// ──────────────────────────────────────────────────
import { encryptField, decryptField } from '../../domain/secrets.js';
