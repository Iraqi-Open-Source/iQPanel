/**
 * Tests for agent protocol: auth rejection, token check, unknown actions.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import net, { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startAgent } from '../agent/protocol.js';
import { registry } from '../agent/registry.js';

// Minimal stub registry for tests
const testRegistry = new Map([
  ['test.echo', {
    timeout: 5000,
    validate({ msg }) { if (!msg) throw new Error('msg required'); },
    async run({ msg }) { return { echo: msg }; },
  }],
  ['test.stream', {
    timeout: 5000,
    async run({ n = 3 }, emit) {
      for (let i = 0; i < n; i++) emit('stdout', `line ${i}\n`);
      return { lines: n };
    },
  }],
]);

// Patch registry temporarily
function withRegistry(map, fn) {
  const saved = new Map(registry);
  registry.clear();
  for (const [k,v] of map) registry.set(k, v);
  try { return fn(); }
  finally { registry.clear(); for (const [k,v] of saved) registry.set(k, v); }
}

async function makeAgent(token) {
  const dir = mkdtempSync(join(tmpdir(), 'iqpanel-test-'));
  const socketPath = join(dir, 'agent.sock');

  const server = await new Promise((resolve) => {
    const s = startAgent({ socketPath, token, onReady: () => resolve(s) });
  });

  return {
    socketPath,
    token,
    async send(msg) {
      return new Promise((resolve, reject) => {
        const sock = net.createConnection(socketPath);
        let buf = '';
        sock.on('data', (chunk) => {
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try { const f = JSON.parse(line); resolve(f); sock.destroy(); } catch {}
          }
        });
        sock.on('connect', () => sock.write(JSON.stringify(msg) + '\n'));
        sock.on('error', reject);
        setTimeout(() => { sock.destroy(); reject(new Error('timeout')); }, 3000);
      });
    },
    close() { server.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

describe('Agent protocol', () => {
  test('rejects invalid token', async () => {
    await withRegistry(testRegistry, async () => {
      const agent = await makeAgent('correct-token');
      const frame = await agent.send({ id: 'x1', token: 'wrong-token', action: 'test.echo', args: { msg: 'hi' } });
      assert.equal(frame.t, 'error');
      assert.match(frame.d, /[Uu]nauthorized/);
      agent.close();
    });
  });

  test('rejects unknown action', async () => {
    await withRegistry(testRegistry, async () => {
      const agent = await makeAgent('mytoken');
      const frame = await agent.send({ id: 'x2', token: 'mytoken', action: 'nonexistent.action', args: {} });
      assert.equal(frame.t, 'error');
      assert.match(frame.d, /[Uu]nknown action/);
      agent.close();
    });
  });

  test('returns result for known action', async () => {
    await withRegistry(testRegistry, async () => {
      const agent = await makeAgent('mytoken');
      const frame = await agent.send({ id: 'x3', token: 'mytoken', action: 'test.echo', args: { msg: 'hello' } });
      assert.equal(frame.t, 'result');
      assert.deepEqual(frame.d, { echo: 'hello' });
      agent.close();
    });
  });

  test('validates args', async () => {
    await withRegistry(testRegistry, async () => {
      const agent = await makeAgent('tok');
      const frame = await agent.send({ id: 'x4', token: 'tok', action: 'test.echo', args: {} });
      assert.equal(frame.t, 'error');
      assert.match(frame.d, /Bad args/);
      agent.close();
    });
  });
});
