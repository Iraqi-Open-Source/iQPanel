import { randomBytes } from 'node:crypto';
import { query, get, run } from '../../data/db.js';
import { hashPassword } from '../session.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';
import { auditLog } from '../../domain/audit.js';

function uuid()   { return randomBytes(16).toString('hex'); }
function nowIso() { return new Date().toISOString(); }

function sanitizeUser(u) {
  const { password_hash, password_salt, totp_secret_enc, backup_codes_enc, ...safe } = u;
  return safe;
}

export function registerUsers(app) {
  app.get('/api/users', requireAuth, rbac('admin'), (req, res) => {
    res.json(query('SELECT * FROM users ORDER BY created_at').map(sanitizeUser));
  });

  app.post('/api/users', requireAuth, rbac('owner'), (req, res) => {
    const { email, name, role, password } = req.body ?? {};
    if (!email || !name || !role || !password) return res.status(400).json({ error: 'email, name, role, password required' });
    if (!['owner','admin','operator','readonly'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (password.length < 8) return res.status(400).json({ error: 'Password too short' });

    const existing = get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const { hash, salt } = hashPassword(password);
    const id = uuid();
    run('INSERT INTO users (id,email,name,role,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?,?)',
      [id, email, name, role, hash, salt, nowIso()]);
    auditLog(req, 'user.create', email, { role });
    res.status(201).json(sanitizeUser(get('SELECT * FROM users WHERE id = ?', [id])));
  });

  app.patch('/api/users/:id', requireAuth, rbac('owner'), (req, res) => {
    const user = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { name, role } = req.body ?? {};
    if (name) run('UPDATE users SET name = ? WHERE id = ?', [name, user.id]);
    if (role) {
      if (!['owner','admin','operator','readonly'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
      run('UPDATE users SET role = ? WHERE id = ?', [role, user.id]);
      auditLog(req, 'user.role_change', user.email, { role });
    }
    res.json(sanitizeUser(get('SELECT * FROM users WHERE id = ?', [user.id])));
  });

  app.delete('/api/users/:id', requireAuth, rbac('owner', { reauth: true }), (req, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    const user = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    run('DELETE FROM users WHERE id = ?', [user.id]);
    auditLog(req, 'user.delete', user.email);
    res.json({ ok: true });
  });

  app.get('/api/audit', requireAuth, rbac('admin'), (req, res) => {
    const limit  = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Number(req.query.offset) || 0;
    const rows   = query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    res.json(rows);
  });
}
