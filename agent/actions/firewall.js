import { execFileSync } from 'node:child_process';

function ufw(...args) {
  return execFileSync('ufw', args, { encoding: 'utf8' });
}

function validatePort(port) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('Invalid port');
  return n;
}

function validateProto(proto) {
  const p = String(proto ?? 'tcp').toLowerCase();
  if (!['tcp', 'udp', 'any'].includes(p)) throw new Error('Invalid protocol');
  return p;
}

function sanitizeComment(comment) {
  if (!comment) return null;
  const s = String(comment).replace(/[^a-zA-Z0-9 _.-]/g, '').trim().slice(0, 60);
  return s || null;
}

export function extractPorts(to) {
  const text = String(to ?? '');
  const ports = new Set();
  const re = /\b(\d{1,5})(?:\s*:\s*\d{1,5})?\b/g;
  let m;
  while ((m = re.exec(text))) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 65535) ports.add(n);
  }
  return [...ports];
}

export function parseUfwOutput(output) {
  const text = String(output ?? '');
  const active = /^Status:\s+active\b/im.test(text)
    ? true
    : /^Status:\s+inactive\b/im.test(text)
      ? false
      : null;
  const logging = text.match(/^Logging:\s+(.+)$/im)?.[1]?.trim() ?? null;
  const defLine = text.match(/^Default:\s+(.+)$/im)?.[1]?.trim() ?? null;
  const defaults = { incoming: null, outgoing: null, routed: null };
  if (defLine) {
    const inc = defLine.match(/(\w+)\s*\(incoming\)/i);
    const out = defLine.match(/(\w+)\s*\(outgoing\)/i);
    const routed = defLine.match(/(\w+)\s*\(routed\)/i);
    if (inc) defaults.incoming = inc[1].toLowerCase();
    if (out) defaults.outgoing = out[1].toLowerCase();
    if (routed) defaults.routed = routed[1].toLowerCase();
  }

  const ACTION_RE = /^(.*?)\s+(ALLOW|DENY|REJECT|LIMIT)(?:\s+(IN|OUT|FWD))?\s+(.*)$/i;
  const rules = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const numbered = line.match(/^\[\s*(\d+)\]\s+(.+)$/);
    if (!numbered) continue;
    let rest = numbered[2].trim();
    let comment = null;
    const hash = rest.search(/\s+#\s+/);
    if (hash !== -1) {
      comment = rest.slice(hash).replace(/^\s+#\s+/, '').trim();
      rest = rest.slice(0, hash).trim();
    }
    const a = rest.match(ACTION_RE);
    const rule = a
      ? {
        number: Number(numbered[1]),
        to: a[1].trim(),
        action: a[2].toUpperCase(),
        direction: (a[3] || 'IN').toUpperCase(),
        from: a[4].trim(),
        comment,
      }
      : {
        number: Number(numbered[1]),
        to: rest,
        action: null,
        direction: 'IN',
        from: '',
        comment,
      };
    const hay = `${rule.to} ${rule.from} ${rule.comment ?? ''}`.toLowerCase();
    rule.ipv6 = /\(v6\)/.test(hay);
    rule.ports = extractPorts(rule.to);
    rules.push(rule);
  }

  return { active, logging, defaults, rules, output: text };
}

const SSH_RE = /\b(ssh|openssh)\b/i;
const HTTPS_RE = /\bhttps\b/i;
const HTTP_RE = /\bhttp\b/i;
const MYSQL_RE = /\b(mysql|mariadb)\b/i;
const POSTGRES_RE = /\b(postgres|postgresql)\b/i;
const REDIS_RE = /\bredis\b/i;

export function classifyTarget({ port, to = '', comment = '', panelPort } = {}) {
  const ports = new Set(extractPorts(to));
  const n = Number(port);
  if (Number.isInteger(n) && n > 0) ports.add(n);
  const hay = `${to} ${comment}`;

  if (ports.has(22) || SSH_RE.test(hay)) {
    return {
      id: 'ssh',
      label: 'SSH',
      level: 'critical',
      port: 22,
      title: 'This can lock you out of SSH',
      message: 'Denying or removing SSH (port 22) can immediately disconnect you from this server. Make sure you have another way in before continuing.',
    };
  }
  const panel = Number(panelPort);
  if (Number.isInteger(panel) && panel > 0 && ports.has(panel)) {
    return {
      id: 'panel',
      label: 'iQPanel',
      level: 'critical',
      port: panel,
      title: 'This can lock you out of the panel',
      message: `Port ${panel} is used by iQPanel. Blocking it can cut off this web interface.`,
    };
  }
  if (ports.has(443) || HTTPS_RE.test(hay)) {
    return {
      id: 'https',
      label: 'HTTPS',
      level: 'high',
      port: 443,
      title: 'This can take sites offline',
      message: 'Blocking HTTPS (port 443) will stop encrypted web traffic to sites on this server.',
    };
  }
  if (ports.has(80) || (HTTP_RE.test(hay) && !HTTPS_RE.test(hay))) {
    return {
      id: 'http',
      label: 'HTTP',
      level: 'high',
      port: 80,
      title: 'This can take sites offline',
      message: 'Blocking HTTP (port 80) will stop unencrypted web traffic and HTTP-01 certificate challenges.',
    };
  }
  if (ports.has(3306) || MYSQL_RE.test(hay)) {
    return {
      id: 'mysql',
      label: 'MySQL',
      level: 'high',
      port: 3306,
      title: 'This can break databases',
      message: 'Blocking MySQL/MariaDB (port 3306) can cut off applications that connect to the database.',
    };
  }
  if (ports.has(5432) || POSTGRES_RE.test(hay)) {
    return {
      id: 'postgres',
      label: 'PostgreSQL',
      level: 'high',
      port: 5432,
      title: 'This can break databases',
      message: 'Blocking PostgreSQL (port 5432) can cut off applications that connect to the database.',
    };
  }
  if (ports.has(6379) || REDIS_RE.test(hay)) {
    return {
      id: 'redis',
      label: 'Redis',
      level: 'high',
      port: 6379,
      title: 'This can break cache and queues',
      message: 'Blocking Redis (port 6379) can stop cache, sessions, and queue workers.',
    };
  }
  return null;
}

function annotateRules(rules, panelPort) {
  return rules.map((rule) => {
    const sensitive = classifyTarget({ to: rule.to, comment: rule.comment, panelPort });
    return { ...rule, sensitive };
  });
}

function ruleSpec({ port, proto = 'tcp' }) {
  return `${validatePort(port)}/${validateProto(proto)}`;
}

export const status = {
  async run({ panelPort } = {}) {
    try {
      let out;
      try { out = ufw('status', 'numbered'); }
      catch { out = ufw('status', 'verbose'); }
      const parsed = parseUfwOutput(out);
      parsed.rules = annotateRules(parsed.rules, panelPort);
      parsed.panel_port = Number(panelPort) || null;
      return parsed;
    } catch {
      return { active: null, logging: null, defaults: {}, rules: [], output: '', error: 'ufw not available' };
    }
  },
};

export const allow = {
  validate({ port }) { validatePort(port); },
  async run({ port, proto = 'tcp', comment }) {
    const rule = ruleSpec({ port, proto });
    const note = sanitizeComment(comment);
    if (note) ufw('allow', rule, 'comment', note);
    else ufw('allow', rule);
    return { allowed: rule };
  },
};

export const deny = {
  validate({ port }) { validatePort(port); },
  async run({ port, proto = 'tcp', comment }) {
    const rule = ruleSpec({ port, proto });
    const note = sanitizeComment(comment);
    if (note) ufw('deny', rule, 'comment', note);
    else ufw('deny', rule);
    return { denied: rule };
  },
};

export const deleteRule = {
  validate(args = {}) {
    if (args.number != null) {
      const n = Number(args.number);
      if (!Number.isInteger(n) || n < 1) throw new Error('Invalid rule number');
      return;
    }
    validatePort(args.port);
  },
  async run({ port, proto = 'tcp', number }) {
    if (number != null) {
      const n = Number(number);
      ufw('--force', 'delete', String(n));
      return { deleted: n };
    }
    try { ufw('--force', 'delete', 'allow', `${port}/${proto}`); } catch {}
    try { ufw('--force', 'delete', 'deny',  `${port}/${proto}`); } catch {}
    return { deleted: `${port}/${proto}` };
  },
};

export const enable = {
  async run() {
    ufw('--force', 'enable');
    return { enabled: true };
  },
};

export const disable = {
  async run() {
    ufw('disable');
    return { enabled: false };
  },
};

export const setDefault = {
  validate({ direction, policy }) {
    const dir = String(direction ?? '').toLowerCase();
    const pol = String(policy ?? '').toLowerCase();
    if (!['incoming', 'outgoing', 'routed'].includes(dir)) throw new Error('Invalid direction');
    if (!['allow', 'deny', 'reject'].includes(pol)) throw new Error('Invalid policy');
  },
  async run({ direction, policy }) {
    ufw('default', String(policy).toLowerCase(), String(direction).toLowerCase());
    return { direction: String(direction).toLowerCase(), policy: String(policy).toLowerCase() };
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
