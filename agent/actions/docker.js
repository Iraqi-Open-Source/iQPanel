import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function dockerExec(...args) {
  return execFileSync('docker', args, { encoding: 'utf8' });
}

const ALLOWED_CONTAINER_ACTIONS = new Set(['start', 'stop', 'restart', 'rm', 'pause', 'unpause', 'kill']);
const ALLOWED_COMPOSE_CMDS = new Set(['up', 'down', 'build', 'pull', 'logs', 'restart', 'ps']);

function assertComposePath(path) {
  if (!path) throw new Error('path required');
  const resolved = path;
  if (!resolved.startsWith('/var/www/sites/') && !resolved.startsWith('/opt/')) throw new Error('path outside allowed roots');
}

export const status = {
  async run() {
    try {
      dockerExec('info', '--format', 'json');
      return { available: true };
    } catch { return { available: false }; }
  },
};

export const containers = {
  async run({ all = true }) {
    const args = ['ps', '--format', 'json', '--no-trunc'];
    if (all) args.push('--all');
    try {
      const out = dockerExec(...args);
      const rows = out.trim().split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      return rows;
    } catch { return []; }
  },
};

export const containerAction = {
  validate({ id, action }) {
    if (!id || !/^[a-f0-9]{6,64}$/.test(id)) throw new Error('Invalid container id');
    if (!ALLOWED_CONTAINER_ACTIONS.has(action)) throw new Error(`Invalid action: ${action}`);
  },
  async run({ id, action }) {
    dockerExec(action, id);
    return { id, action };
  },
};

export const images = {
  async run() {
    try {
      const out = dockerExec('images', '--format', 'json');
      return out.trim().split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch { return []; }
  },
};

export const compose = {
  timeout: 600_000,
  validate({ path, cmd }) {
    assertComposePath(path);
    if (!ALLOWED_COMPOSE_CMDS.has(cmd)) throw new Error(`Invalid compose cmd: ${cmd}`);
  },
  async run({ path, cmd, args = [] }, emit) {
    const file = existsSync(join(path, 'docker-compose.yml'))
      ? join(path, 'docker-compose.yml')
      : join(path, 'compose.yml');

    return new Promise((resolve, reject) => {
      const proc = spawn('docker', ['compose', '-f', file, cmd, ...args], { cwd: path });
      proc.stdout.on('data', (d) => emit?.('stdout', d.toString()));
      proc.stderr.on('data', (d) => emit?.('stderr', d.toString()));
      proc.on('close', (code) => {
        emit?.('exit', null, { code });
        if (code === 0) resolve({ cmd, code });
        else reject(new Error(`compose ${cmd} exited ${code}`));
      });
    });
  },
};

export const logs = {
  timeout: 30_000,
  validate({ id }) {
    if (!id || !/^[a-f0-9]{6,64}$/.test(id)) throw new Error('Invalid container id');
  },
  async run({ id, lines = 100 }, emit) {
    const n = Math.min(Number(lines) || 100, 10_000);
    const out = dockerExec('logs', '--tail', String(n), id);
    emit?.('stdout', out);
    return { id };
  },
};

export const prune = {
  async run({ target = 'containers' }) {
    const allowed = new Set(['containers', 'images', 'volumes', 'system']);
    if (!allowed.has(target)) throw new Error('Invalid prune target');
    dockerExec('system', 'prune', '-f');
    return { pruned: target };
  },
};
