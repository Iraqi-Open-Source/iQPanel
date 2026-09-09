import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';

const ALLOWED_UNITS = /^(nginx|apache2|httpd|mysql|mariadb|postgresql|redis-server|redis|docker|ufw|ssh|sshd|fail2ban|iqpanel|iqpanel-agent|iqpanel-worker|php\d+\.\d+-fpm|panel-[a-z0-9-]+-[a-z]+)\.service$|^postgresql@.+\.service$/;

function assertUnit(unit) {
  if (!ALLOWED_UNITS.test(unit)) throw new Error(`Unit not allowed: ${unit}`);
}

function ctl(...args) {
  return execFileSync('systemctl', args, { encoding: 'utf8' });
}

function isUfwUnit(unit) {
  return unit === 'ufw.service' || unit === 'ufw';
}

function entryUnit(s) {
  return String(s?.unit ?? s?.Unit ?? s?.Id ?? s?.name ?? '');
}

/**
 * systemd's ufw.service is Type=oneshot. After boot it often shows
 * inactive/dead even while `ufw status` reports the firewall as active.
 * Operational UFW state is the source of truth for the panel.
 */
export function parseUfwStatus(output) {
  const text = String(output ?? '');
  if (/^Status:\s+active\b/im.test(text)) return true;
  if (/^Status:\s+inactive\b/im.test(text)) return false;
  return null;
}

export function readUfwOperationalActive() {
  try {
    const parsed = parseUfwStatus(runUfw('status'));
    if (parsed !== null) return parsed;
  } catch {}
  try {
    const conf = readFileSync('/etc/ufw/ufw.conf', 'utf8');
    const m = conf.match(/^\s*ENABLED=(yes|no)\s*$/im);
    if (m) return m[1].toLowerCase() === 'yes';
  } catch {}
  return null;
}

export function overlayUfwOnUnits(units, ufwActive) {
  if (ufwActive !== true && ufwActive !== false) return Array.isArray(units) ? units : [];
  const list = Array.isArray(units) ? units : [];
  const desired = ufwActive ? 'active' : 'inactive';
  const sub = ufwActive ? 'exited' : 'dead';
  let found = false;
  const mapped = list.map((s) => {
    const name = entryUnit(s);
    if (name !== 'ufw.service' && name !== 'ufw') return s;
    found = true;
    return {
      ...s,
      unit: name.endsWith('.service') ? name : 'ufw.service',
      active: desired,
      sub,
      ActiveState: desired,
      SubState: sub,
    };
  });
  if (!found && ufwActive) {
    mapped.push({
      unit: 'ufw.service',
      load: 'loaded',
      active: desired,
      sub,
      description: 'Uncomplicated firewall',
      ActiveState: desired,
      SubState: sub,
    });
  }
  return mapped;
}

function overlayUfwOnStatus(unit, result) {
  if (!isUfwUnit(unit)) return result;
  const ufwActive = readUfwOperationalActive();
  if (ufwActive === true) {
    return { ...result, ActiveState: 'active', SubState: result.SubState === 'dead' ? 'exited' : (result.SubState || 'exited') };
  }
  if (ufwActive === false) {
    return { ...result, ActiveState: 'inactive', SubState: result.SubState || 'dead' };
  }
  return result;
}

function ufwBin() {
  if (existsSync('/usr/sbin/ufw')) return '/usr/sbin/ufw';
  if (existsSync('/sbin/ufw')) return '/sbin/ufw';
  return 'ufw';
}

function runUfw(...args) {
  return execFileSync(ufwBin(), args, { encoding: 'utf8' });
}

export const list = {
  async run() {
    const out = execFileSync('systemctl', [
      'list-units', '--type=service', '--all',
      '--no-pager', '--no-legend',
      '--output=json',
    ], { encoding: 'utf8' });
    let units = [];
    try { units = JSON.parse(out); } catch { units = []; }
    return overlayUfwOnUnits(units, readUfwOperationalActive());
  },
};

export const start = {
  validate: ({ unit }) => assertUnit(unit),
  async run({ unit }, emit) {
    if (isUfwUnit(unit)) {
      const out = runUfw('--force', 'enable');
      emit('stdout', out);
      try { ctl('start', 'ufw.service'); } catch {}
      emit('stdout', `Started ${unit}`);
      return { unit, action: 'start' };
    }
    ctl('start', unit);
    emit('stdout', `Started ${unit}`);
    return { unit, action: 'start' };
  },
};

export const stop = {
  validate: ({ unit }) => assertUnit(unit),
  async run({ unit }, emit) {
    if (isUfwUnit(unit)) {
      const out = runUfw('disable');
      emit('stdout', out);
      try { ctl('stop', 'ufw.service'); } catch {}
      emit('stdout', `Stopped ${unit}`);
      return { unit, action: 'stop' };
    }
    ctl('stop', unit);
    emit('stdout', `Stopped ${unit}`);
    return { unit, action: 'stop' };
  },
};

export const restart = {
  validate: ({ unit }) => assertUnit(unit),
  async run({ unit }, emit) {
    if (isUfwUnit(unit)) {
      try {
        emit('stdout', runUfw('reload'));
      } catch {
        emit('stdout', runUfw('--force', 'enable'));
      }
      try { ctl('restart', 'ufw.service'); } catch {}
      emit('stdout', `Restarted ${unit}`);
      return { unit, action: 'restart' };
    }
    ctl('restart', unit);
    emit('stdout', `Restarted ${unit}`);
    return { unit, action: 'restart' };
  },
};

export const enable  = { validate: ({unit})=>assertUnit(unit), async run({unit},emit) { ctl('enable',unit);  emit('stdout',`Enabled ${unit}`); return {unit,action:'enable'}; } };
export const disable = { validate: ({unit})=>assertUnit(unit), async run({unit},emit) { ctl('disable',unit); emit('stdout',`Disabled ${unit}`); return {unit,action:'disable'}; } };

export const status = {
  validate({ unit }) { assertUnit(unit); },
  async run({ unit }) {
    try {
      const out = execFileSync('systemctl', ['show', unit,
        '--property=ActiveState,SubState,LoadState,UnitFileState',
        '--no-pager',
      ], { encoding: 'utf8' });
      const result = {};
      for (const line of out.split('\n')) {
        const [k, v] = line.split('=');
        if (k) result[k] = v;
      }
      return overlayUfwOnStatus(unit, result);
    } catch {
      return overlayUfwOnStatus(unit, { ActiveState: 'unknown' });
    }
  },
};

export const journal = {
  timeout: 15_000,
  validate({ unit }) { assertUnit(unit); },
  async run({ unit, lines = 100 }, emit) {
    const n = Math.min(Number(lines) || 100, 5000);
    const out = execFileSync('journalctl', ['-u', unit, '-n', String(n), '--no-pager', '--output=short-iso'], { encoding: 'utf8' });
    emit('stdout', out);
    return { unit, lines: n };
  },
};

export const installUnit = {
  validate({ name, content }) {
    if (!name || !/^panel-[a-z0-9-]+-[a-z]+\.service$/.test(name)) throw new Error('Invalid unit name');
    if (!content || typeof content !== 'string') throw new Error('content required');
    if (content.length > 65536) throw new Error('Unit file too large');
  },
  async run({ name, content }) {
    const path = `/etc/systemd/system/${name}`;
    writeFileSync(path, content, { mode: 0o644 });
    execFileSync('systemctl', ['daemon-reload'], { encoding: 'utf8' });
    return { path };
  },
};

export const removeUnit = {
  validate({ name }) {
    if (!name || !/^panel-[a-z0-9-]+-[a-z]+\.service$/.test(name)) throw new Error('Invalid unit name');
  },
  async run({ name }) {
    const path = `/etc/systemd/system/${name}`;
    try { ctl('stop', name); } catch {}
    try { ctl('disable', name); } catch {}
    if (existsSync(path)) unlinkSync(path);
    try { ctl('daemon-reload'); } catch {}
    return { removed: name };
  },
};
