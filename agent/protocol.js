/**
 * NDJSON multiplexed agent protocol.
 *
 * Each line on the socket is a JSON object. Requests carry { id, token, action, args, stream }.
 * The agent writes response frames: { id, t, d?, code? }
 *   t: "result"  – final result (d = data)
 *   t: "stdout"  – streamed output line
 *   t: "stderr"  – streamed error line
 *   t: "exit"    – process exited (code = number)
 *   t: "error"   – action failed (d = message)
 *
 * The connection is persistent. Multiple requests can be in-flight simultaneously.
 */

import { createServer } from 'node:net';
import { createHash, timingSafeEqual } from 'node:crypto';
import { chmodSync, chownSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { registry } from './registry.js';

const MAX_LINE = 4 * 1024 * 1024; // 4 MB per request

function applySocketPerms(socketPath) {
  try { chmodSync(socketPath, 0o660); } catch {}
  try {
    const out = spawnSync('getent', ['group', 'panel'], { encoding: 'utf8' });
    const gid = parseInt((out.stdout || '').split(':')[2], 10);
    if (Number.isFinite(gid)) chownSync(socketPath, 0, gid);
  } catch {}
}

export function startAgent({ socketPath, token, onReady } = {}) {
  try { unlinkSync(socketPath); } catch { /* no stale socket */ }

  const server = createServer({ allowHalfOpen: false }, (socket) => {
    handleConnection(socket, token);
  });

  server.on('error', (err) => {
    console.error('[agent] server error', err.message);
    process.exit(1);
  });

  server.listen(socketPath, () => {
    applySocketPerms(socketPath);
    onReady?.();
  });

  return server;
}

function handleConnection(socket, expectedToken) {
  let buf = '';
  const inflight = new Map();

  const send = (frame) => {
    try { socket.write(JSON.stringify(frame) + '\n'); } catch {}
  };

  socket.setEncoding('utf8');

  socket.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    if (buf.length > MAX_LINE) { socket.destroy(); return; }

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      handleRequest(trimmed, send, expectedToken, inflight, socket);
    }
  });

  socket.on('close', () => {
    for (const abort of inflight.values()) abort();
    inflight.clear();
  });

  socket.on('error', () => socket.destroy());
}

async function handleRequest(raw, send, expectedToken, inflight, socket) {
  let req;
  try { req = JSON.parse(raw); } catch {
    send({ id: null, t: 'error', d: 'Invalid JSON' });
    return;
  }

  const { id, token, action, args = {}, stream = false } = req;
  if (!id) { send({ id: null, t: 'error', d: 'Missing id' }); return; }

  // Token check – constant-time
  const providedBuf = Buffer.from(String(token ?? ''));
  const expectedBuf = Buffer.from(expectedToken);
  const tokenHash = (b) => createHash('sha256').update(b).digest();
  if (!timingSafeEqual(tokenHash(providedBuf), tokenHash(expectedBuf))) {
    send({ id, t: 'error', d: 'Unauthorized' });
    socket.destroy();
    return;
  }

  const entry = registry.get(action);
  if (!entry) { send({ id, t: 'error', d: `Unknown action: ${action}` }); return; }

  // Validate args
  try { entry.validate?.(args); } catch (e) {
    send({ id, t: 'error', d: `Bad args: ${e.message}` });
    return;
  }

  let aborted = false;
  const abort = () => { aborted = true; };
  inflight.set(id, abort);

  const emit = stream
    ? (t, d, extra = {}) => { if (!aborted) send({ id, t, d, ...extra }); }
    : () => {};

  const timeout = entry.timeout ?? 60_000;
  const timer = setTimeout(() => {
    if (!inflight.has(id)) return;
    abort();
    send({ id, t: 'error', d: 'Action timed out' });
    inflight.delete(id);
  }, timeout);

  try {
    const result = await entry.run(args, emit);
    if (!aborted) send({ id, t: 'result', d: result });
  } catch (e) {
    if (!aborted) send({ id, t: 'error', d: e.message });
  } finally {
    clearTimeout(timer);
    inflight.delete(id);
  }
}
