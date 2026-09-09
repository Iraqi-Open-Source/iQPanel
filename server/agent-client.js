/**
 * Client that talks to the agent over the Unix socket.
 * Each call opens a new connection for simplicity;
 * multiplexing is handled by the protocol layer on the agent side.
 */
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';

const SOCKET  = process.env.PANEL_AGENT_SOCKET ?? '/run/iqpanel-agent.sock';
const TOKEN   = process.env.PANEL_AGENT_TOKEN   ?? '';
const TIMEOUT = 120_000;

function requestId() {
  return randomBytes(8).toString('hex');
}

/**
 * Send a single non-streaming request; returns the result.
 */
export function invoke(action, args = {}) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(SOCKET);
    const id = requestId();
    let buf = '';

    socket.setTimeout(TIMEOUT, () => {
      socket.destroy();
      reject(new Error(`Agent call timed out: ${action}`));
    });

    socket.on('error', reject);

    socket.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let frame;
        try { frame = JSON.parse(line); } catch { continue; }
        if (frame.id !== id) continue;
        socket.destroy();
        if (frame.t === 'result') resolve(frame.d);
        else reject(new Error(frame.d ?? 'Agent error'));
      }
    });

    socket.on('connect', () => {
      socket.write(JSON.stringify({ id, token: TOKEN, action, args, stream: false }) + '\n');
    });
  });
}

/**
 * Send a streaming request. Calls `onFrame(t, d)` for each frame.
 * Returns a promise that resolves with the final result.
 */
export function stream(action, args = {}, onFrame) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(SOCKET);
    const id = requestId();
    let buf = '';

    socket.setTimeout(600_000, () => {
      socket.destroy();
      reject(new Error(`Agent stream timed out: ${action}`));
    });

    socket.on('error', reject);

    socket.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let frame;
        try { frame = JSON.parse(line); } catch { continue; }
        if (frame.id !== id) continue;
        onFrame?.(frame.t, frame.d, frame);
        if (frame.t === 'result') { socket.destroy(); resolve(frame.d); }
        else if (frame.t === 'error') { socket.destroy(); reject(new Error(frame.d)); }
      }
    });

    socket.on('connect', () => {
      socket.write(JSON.stringify({ id, token: TOKEN, action, args, stream: true }) + '\n');
    });
  });
}
