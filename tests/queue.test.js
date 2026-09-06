const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-queue-'));
process.env.PANEL_DATA_ROOT = dataRoot;
process.env.PANEL_SITES_ROOT = path.join(dataRoot, 'sites');

const queue = require('../queue');

test('enqueues a job and claims it once', () => {
  const job = queue.enqueue('backup', { slug: 'demo' }, { maxAttempts: 3 });
  assert.equal(job.status, 'queued');
  const claimed = queue.claim();
  assert.equal(claimed.id, job.id);
  assert.equal(claimed.status, 'running');
  assert.equal(claimed.attempts, 1);
  assert.equal(queue.claim(), null);
});

test('retries a failed job until max attempts then marks it failed', () => {
  const job = queue.enqueue('deploy', { slug: 'retry-me' }, { maxAttempts: 2 });
  queue.claim();
  queue.fail(job.id, 'clone failed');
  const retried = queue.get(job.id);
  assert.equal(retried.status, 'queued');
  queue.claim();
  queue.fail(job.id, 'clone failed again');
  const finished = queue.get(job.id);
  assert.equal(finished.status, 'failed');
  assert.equal(finished.attempts, 2);
  assert.match(finished.last_error, /clone failed again/);
});

test('stores a successful job result', () => {
  const job = queue.enqueue('install', { slug: 'ok' });
  queue.claim();
  queue.complete(job.id, { output: 'done' });
  const finished = queue.get(job.id);
  assert.equal(finished.status, 'succeeded');
  assert.match(finished.result, /done/);
});
