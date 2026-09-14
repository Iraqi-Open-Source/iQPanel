import { query } from '../data/db.js';
import { invoke } from '../agent-client.js';

const PORT_RANGE_START = 8000;
const PORT_RANGE_END   = 8999;

export function dbUsedPorts({ excludeSiteId } = {}) {
  const sql = excludeSiteId
    ? 'SELECT port FROM sites WHERE port IS NOT NULL AND id != ?'
    : 'SELECT port FROM sites WHERE port IS NOT NULL';
  const params = excludeSiteId ? [excludeSiteId] : [];
  return new Set(
    query(sql, params)
      .map((r) => Number(r.port))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
}

export function panelPort() {
  const n = Number(process.env.PANEL_PORT);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function listenerPorts({ invokeFn = invoke } = {}) {
  const listeners = new Set();
  try {
    const rows = await invokeFn('fw.listeners');
    if (Array.isArray(rows)) {
      for (const r of rows) {
        const m = String(r?.local ?? '').match(/:(\d+)$/);
        if (m) listeners.add(Number(m[1]));
      }
    }
  } catch {}
  return listeners;
}

export async function allocatePort({ invokeFn = invoke } = {}) {
  const used = dbUsedPorts();
  const panel = panelPort();
  if (panel != null) used.add(panel);

  const listeners = await listenerPorts({ invokeFn });

  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (!used.has(p) && !listeners.has(p)) return p;
  }
  throw new Error('No free port available in range 8000-8999');
}

export async function assertPortFree(port, { excludeSiteId, allowPort, invokeFn = invoke } = {}) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    const e = new Error('Invalid port');
    e.status = 400;
    throw e;
  }
  if (n === 80 || n === 443) {
    const e = new Error('Ports 80 and 443 are reserved for domain-based sites');
    e.status = 400;
    throw e;
  }
  const panel = panelPort();
  if (panel != null && n === panel) {
    const e = new Error(`Port ${n} is used by the panel`);
    e.status = 400;
    throw e;
  }
  if (allowPort != null && Number(allowPort) === n) return n;

  if (dbUsedPorts({ excludeSiteId }).has(n)) {
    const e = new Error(`Port ${n} is already assigned to another site`);
    e.status = 400;
    throw e;
  }
  const listeners = await listenerPorts({ invokeFn });
  if (listeners.has(n)) {
    const e = new Error(`Port ${n} is already in use`);
    e.status = 400;
    throw e;
  }
  return n;
}
