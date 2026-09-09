/**
 * Role-based access control.
 * Roles: owner > admin > operator > readonly
 */

const RANK = { owner: 4, admin: 3, operator: 2, readonly: 1 };

export function roleRank(role) {
  return RANK[role] ?? 0;
}

export function hasRole(userOrRole, required) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return roleRank(role) >= roleRank(required);
}

/**
 * Express-style middleware factory.
 * usage: router.post('/foo', rbac('operator'), handler)
 */
export function rbac(required, { reauth = false } = {}) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Unauthenticated' });
    if (!hasRole(user, required)) return res.status(403).json({ error: 'Forbidden' });
    if (reauth && !req.reauthValid) return res.status(403).json({ error: 'Re-authentication required', code: 'reauth' });
    next();
  };
}

export const ROLES = Object.keys(RANK);
