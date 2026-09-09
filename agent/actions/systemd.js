import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';

const ALLOWED_UNITS = /^(nginx|apache2|httpd|mysql|mariadb|postgresql|redis-server|redis|docker|ufw|ssh|sshd|fail2ban|iqpanel|iqpanel-agent|iqpanel-worker|php\d+\.\d+-fpm|panel-[a-z0-9-]+-[a-z]+)\.service$|^postgresql@.+\.service$/;

function assertUnit(unit) {
  if (!ALLOWED_UNITS.test(unit)) throw new Error(`Unit not allowed: ${unit}`);
}

function ctl(...args) {
  return execFileSync('systemctl', args, { encoding: 'utf8' });
}

export const list = {
  async run() {
    const out = execFileSync('systemctl', [
      'list-units', '--type=service', '--all',
      '--no-pager', '--no-legend',
      '--output=json',
    ], { encoding: 'utf8' });
    try { return JSON.parse(out); } catch { return []; }
  },
};

export const start   = { validate: ({unit})=>assertUnit(unit), async run({unit},emit) { ctl('start',unit); emit('stdout',`Started ${unit}`); return {unit,action:'start'}; } };
export const stop    = { validate: ({unit})=>assertUnit(unit), async run({unit},emit) { ctl('stop',unit);  emit('stdout',`Stopped ${unit}`); return {unit,action:'stop'}; } };
export const restart = { validate: ({unit})=>assertUnit(unit), async run({unit},emit) { ctl('restart',unit); emit('stdout',`Restarted ${unit}`); return {unit,action:'restart'}; } };
export const enable  = { validate: ({unit})=>assertUnit(unit), async run({unit},emit) { ctl('enable',unit);  emit('stdout',`Enabled ${unit}`); return {unit,action:'enable'}; } };
export const disable = { validate: ({unit})=>assertUnit(unit), async run({unit},emit) { ctl('disable',unit); emit('stdout',`Disabled ${unit}`); return {unit,action:'disable'}; } };

export const status = {
  validate({unit}) { assertUnit(unit); },
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
      return result;
    } catch { return { ActiveState: 'unknown' }; }
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
