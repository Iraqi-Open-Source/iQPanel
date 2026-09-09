/**
 * Async route handlers must return 500 instead of crashing the process.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../server/http/router.js';

function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve) => {
    server.once('listening', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

describe('async route errors', () => {
  test('rejected handler returns JSON 500', async () => {
    const app = new Router();
    app.get('/boom', async () => {
      await Promise.resolve();
      throw new Error('kaboom');
    });
    const { server, port } = await listen(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/boom`);
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.error, 'kaboom');
    } finally {
      server.close();
    }
  });

  test('POST JSON body is parsed before the handler', async () => {
    const app = new Router();
    app.post('/echo', (req, res) => res.json(req.body));
    const { server, port } = await listen(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'app', php_version: '8.4', domain: null }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.php_version, '8.4');
      assert.equal(body.domain, null);
    } finally {
      server.close();
    }
  });
});
