const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const paths = require('./paths');

const sessions = new Map();

function defaultShell() {
  const shell = String(process.env.SHELL || '').trim();
  if (shell && !/(?:nologin|false)$/.test(shell)) return shell;
  return 'bash';
}

function userExists(user) {
  try {
    execFileSync('id', ['-u', user], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sudoAvailable(user) {
  try {
    execFileSync('sudo', ['-n', '-u', user, 'true'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function createSession(options = {}) {
  const id = crypto.randomUUID();
  let command = options.command || defaultShell();
  let args = Array.isArray(options.args) ? options.args : [];
  const requested = options.user || null;
  let user = requested || null;
  let runAs = null;
  let restricted = null;
  if (requested) {
    if (!paths.applySystem) {
      runAs = null;
    } else if (!userExists(requested)) {
      restricted = `site user ${requested} does not exist on this server — falling back to the panel user`;
    } else if (!sudoAvailable(requested)) {
      restricted = 'passwordless sudo is not configured for the panel user — falling back to the panel user';
    } else {
      runAs = requested;
    }
  }
  if (runAs) {
    args = ['-u', runAs, '--', command, ...args];
    command = 'sudo';
  }
  const child = spawn(command, args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const session = { id, child, chunks: [], closed: false, exitError: null, startedAt: new Date().toISOString(), user, cwd: options.cwd || process.cwd(), restricted };
  const append = (chunk) => { session.chunks.push(Buffer.from(chunk)); };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.on('close', () => { session.closed = true; });
  child.on('error', (error) => {
    session.exitError = error.message;
    session.chunks.push(Buffer.from(`# terminal error: ${error.message}\n`));
    session.closed = true;
  });
  sessions.set(id, session);
  return { id, startedAt: session.startedAt, user, cwd: session.cwd, restricted };
}

function requireSession(id) {
  const session = sessions.get(id);
  if (!session) throw new Error('Unknown terminal session');
  return session;
}

function write(id, data) {
  const session = requireSession(id);
  if (session.closed) throw new Error('Terminal session has closed — press Start session to reconnect');
  session.child.stdin.write(String(data ?? ''));
}

function read(id) {
  const session = sessions.get(id);
  if (!session) return '';
  return Buffer.concat(session.chunks).toString('utf8');
}

function get(id) {
  return sessions.get(id);
}

function snapshot(id) {
  const session = requireSession(id);
  return { id, text: read(id), closed: session.closed, startedAt: session.startedAt, user: session.user || null, cwd: session.cwd, restricted: session.restricted || null };
}

function close(id) {
  const session = sessions.get(id);
  if (!session) return;
  try { session.child.stdin.end(); } catch {}
  session.child.kill('SIGTERM');
  sessions.delete(id);
}

function list() {
  return [...sessions.values()].map((session) => ({
    id: session.id,
    closed: session.closed,
    startedAt: session.startedAt,
  }));
}

module.exports = { createSession, write, read, get, snapshot, close, list };
