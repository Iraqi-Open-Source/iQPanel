import { query, get } from '../data/db.js';
import { invoke } from '../agent-client.js';

const PORT_RANGE_START = 8000;
const PORT_RANGE_END   = 8999;

export async function allocatePort() {
  const used = new Set(
    query('SELECT port FROM sites WHERE port IS NOT NULL').map((r) => r.port)
  );

  let listeners = new Set();
  try {
    const rows = await invoke('fw.listeners');
    for (const r of rows) {
      const m = r.local?.match(/:(\d+)$/);
      if (m) listeners.add(Number(m[1]));
    }
  } catch {}

  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (!used.has(p) && !listeners.has(p)) return p;
  }
  throw new Error('No free port available in range 8000-8999');
}
