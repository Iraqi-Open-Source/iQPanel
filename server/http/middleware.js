import { getSession, findUserById, isReauthValid, verifyCsrf } from './session.js';

export function authMiddleware(req, res, next) {
  const token = req.cookies?.['iqpanel_session'];
  req.user         = null;
  req.session      = null;
  req.reauthValid  = false;

  if (!token) { next(); return; }

  const sess = getSession(token);
  if (!sess) { res.clearCookie('iqpanel_session'); next(); return; }

  const user = findUserById(sess.user_id);
  if (!user) { next(); return; }

  req.session     = sess;
  req.user        = user;
  req.reauthValid = isReauthValid(sess);

  // CSRF for mutating methods
  if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    const provided = req.headers['x-csrf-token'] ?? req.body?.['_csrf'];
    if (!verifyCsrf(token, provided)) {
      res.status(403).json({ error: 'CSRF token mismatch' });
      return;
    }
  }

  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) { res.status(401).json({ error: 'Unauthenticated' }); return; }
  next();
}
