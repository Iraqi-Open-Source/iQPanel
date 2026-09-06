const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const sessions = new Map();

function createSession(options = {}) {
  const id = crypto.randomUUID();
  const command = options.command || process.env.SHELL || 'bash';
  const args = Array.isArray(options.args) ? options.args : [];
  const child = spawn(command, args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const session = { id, child, chunks: [], closed: false, startedAt: new Date().toISOString() };
  const append = (chunk) => { session.chunks.push(Buffer.from(chunk)); };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.on('close', () => { session.closed = true; });
  child.on('error', (error) => {
    session.chunks.push(Buffer.from(String(error.message)));
    session.closed = true;
  });
  sessions.set(id, session);
  return { id, startedAt: session.startedAt };
}

function requireSession(id) {
  const session = sessions.get(id);
  if (!session) throw new Error('Unknown terminal session');
  return session;
}

function write(id, data) {
  const session = requireSession(id);
  if (session.closed) throw new Error('Terminal session has closed');
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
  return { id, text: read(id), closed: session.closed, startedAt: session.startedAt };
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
