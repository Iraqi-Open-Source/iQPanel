import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

const REDIS_CONF_PATHS = [
  '/etc/redis/redis.conf',
  '/etc/redis.conf',
];

function unquote(value) {
  const v = String(value ?? '').trim();
  if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2)
    || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
    return v.slice(1, -1);
  }
  return v;
}

function parseDirectiveValue(rest) {
  const trimmed = String(rest ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    return end > 0 ? trimmed.slice(1, end) : trimmed.slice(1);
  }
  if (trimmed.startsWith("'")) {
    const end = trimmed.indexOf("'", 1);
    return end > 0 ? trimmed.slice(1, end) : trimmed.slice(1);
  }
  return trimmed.split(/\s+#/)[0].trim();
}

export function parseRedisAuth(text) {
  let password = null;
  const includes = [];
  for (const raw of String(text ?? '').split(/\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const inc = line.match(/^include(?:file)?\s+(.+?)\s*$/i);
    if (inc) {
      includes.push(unquote(inc[1].split(/\s+#/)[0].trim()));
      continue;
    }

    const req = line.match(/^requirepass\s+(.+)$/i);
    if (req) {
      password = parseDirectiveValue(req[1]);
      continue;
    }

    const acl = line.match(/^user\s+default\b(.*)$/i);
    if (acl) {
      if (/\bnopass\b/.test(acl[1])) {
        password = null;
        continue;
      }
      const m = acl[1].match(/>(\S+)/);
      if (m) password = m[1];
    }
  }
  return { password, includes };
}

function isAllowedRedisConf(path) {
  const abs = resolve(path);
  return abs === '/etc/redis.conf' || abs.startsWith('/etc/redis/');
}

export const password = {
  async run() {
    const seen = new Set();
    let found = null;
    const queue = REDIS_CONF_PATHS.filter((p) => existsSync(p));

    while (queue.length) {
      const path = resolve(queue.shift());
      if (!isAllowedRedisConf(path) || seen.has(path) || !existsSync(path)) continue;
      seen.add(path);
      let text = '';
      try { text = readFileSync(path, 'utf8'); } catch { continue; }
      const parsed = parseRedisAuth(text);
      if (parsed.password != null) found = parsed.password;
      for (const inc of parsed.includes) {
        if (inc) queue.push(inc);
      }
    }

    const configured = Boolean(found);
    return { configured, password: configured ? found : null };
  },
};
