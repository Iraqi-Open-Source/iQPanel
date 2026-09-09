import { randomBytes } from 'node:crypto';
import { run } from '../data/db.js';

function uuid() { return randomBytes(16).toString('hex'); }

export function auditLog(req, action, target, detail = {}) {
  try {
    run('INSERT INTO audit_log (id,user_id,action,target,detail,ip,created_at) VALUES (?,?,?,?,?,?,?)', [
      uuid(),
      req?.user?.id ?? null,
      action,
      target ?? '',
      JSON.stringify(detail),
      req?.headers?.['x-forwarded-for'] ?? req?.socket?.remoteAddress ?? null,
      new Date().toISOString(),
    ]);
  } catch {}
}
