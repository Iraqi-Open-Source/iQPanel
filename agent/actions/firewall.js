import { execFileSync } from 'node:child_process';

function ufw(...args) {
  return execFileSync('ufw', args, { encoding: 'utf8' });
}

function validatePort(port) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('Invalid port');
  return n;
}

export const status = {
  async run() {
    try {
      const out = ufw('status', 'verbose');
      return { output: out };
    } catch { return { output: '', error: 'ufw not available' }; }
  },
};

export const allow = {
  validate({ port }) { validatePort(port); },
  async run({ port, proto = 'tcp', comment }) {
    const rule = `${port}/${proto}`;
    ufw('allow', rule);
    return { allowed: rule };
  },
};

export const deny = {
  validate({ port }) { validatePort(port); },
  async run({ port, proto = 'tcp' }) {
    const rule = `${port}/${proto}`;
    ufw('deny', rule);
    return { denied: rule };
  },
};

export const deleteRule = {
  validate({ port }) { validatePort(port); },
  async run({ port, proto = 'tcp' }) {
    try { ufw('delete', 'allow', `${port}/${proto}`); } catch {}
    try { ufw('delete', 'deny',  `${port}/${proto}`); } catch {}
    return { deleted: `${port}/${proto}` };
  },
};

export const listeners = {
  async run() {
    try {
      const out = execFileSync('ss', ['-ltnp'], { encoding: 'utf8' });
      const lines = out.split('\n').slice(1).filter(Boolean);
      return lines.map((l) => {
        const parts = l.split(/\s+/);
        return {
          state:   parts[0],
          recvQ:   parts[1],
          sendQ:   parts[2],
          local:   parts[3],
          peer:    parts[4],
          process: parts.slice(5).join(' '),
        };
      });
    } catch { return []; }
  },
};
