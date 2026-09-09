import { execFileSync } from 'node:child_process';

function cli(...args) {
  return execFileSync('redis-cli', args, { encoding: 'utf8' }).trim();
}

export const status = {
  async run() {
    try {
      const pong = cli('PING');
      const unit = execFileSync('systemctl', ['is-active', 'redis-server'], { encoding: 'utf8' }).trim();
      return { active: unit === 'active', ping: pong === 'PONG' };
    } catch {
      return { active: false, ping: false };
    }
  },
};

export const flush = {
  async run({ db = 'all' }) {
    if (db === 'all') cli('FLUSHALL');
    else cli('FLUSHDB');
    return { flushed: db };
  },
};

export const info = {
  async run() {
    try { return { info: cli('INFO') }; } catch { return { info: '' }; }
  },
};
