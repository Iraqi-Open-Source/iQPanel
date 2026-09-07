const { send, db, currentUser } = require('./http-shared');

async function handleAudit(request, response, pathname, searchParams) {
  if (!(request.method === 'GET' && pathname === '/api/audit')) return false;
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') || 50)));
  const offset = Math.max(0, Number(searchParams.get('offset') || 0));
  const parts = ['1=1'];
  const action = searchParams.get('action');
  const target = searchParams.get('target');
  const userId = searchParams.get('user_id');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (action) parts.push(`action=${db.sql(action)}`);
  if (target) parts.push(`target=${db.sql(target)}`);
  if (userId) parts.push(`user_id=${db.sql(userId)}`);
  if (from) parts.push(`created_at>=${db.sql(from)}`);
  if (to) parts.push(`created_at<=${db.sql(to)}`);
  const where = parts.join(' AND ');
  const total = Number(db.rows(`SELECT COUNT(*) AS c FROM activity_log WHERE ${where}`)[0]?.c || 0);
  const qualified = where
    .replaceAll('action=', 'activity_log.action=')
    .replaceAll('target=', 'activity_log.target=')
    .replaceAll('user_id=', 'activity_log.user_id=')
    .replaceAll('created_at', 'activity_log.created_at');
  const items = db.rows(`SELECT activity_log.*, users.email AS actor_email, users.name AS actor_name, users.role AS actor_role
    FROM activity_log LEFT JOIN users ON users.id = activity_log.user_id
    WHERE ${qualified}
    ORDER BY activity_log.created_at DESC
    LIMIT ${limit} OFFSET ${offset}`);
  send(response, 200, { items, limit, offset, total, viewer: currentUser() });
  return true;
}

module.exports = { handleAudit };
