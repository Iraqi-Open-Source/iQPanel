/**
 * Deploy jobs stay queued forever if run_after (ISO-8601) is compared
 * to SQLite datetime('now') (`YYYY-MM-DD HH:MM:SS`).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PANEL_DATA_ROOT = mkdtempSync(join(tmpdir(), 'iqpanel-jobs-'));
process.env.PANEL_SECRET_KEY = 'test-secret-key-for-tests-only-32';

const { run, get } = await import('../server/data/db.js');
const { nextQueuedJob, markJobRunning, recoverStaleRunningJobs } = await import('../server/domain/jobs.js');

function insertJob({ id = 'job-1', status = 'queued', runAfter, attempts = 0 } = {}) {
  const now = '2026-09-09T16:46:30.041Z';
  run(
    `INSERT INTO jobs (id,type,payload,status,attempts,max_attempts,last_error,run_after,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, 'deploy', JSON.stringify({ site_id: 's1', deployment_id: 'd1' }), status, attempts, 3, '', runAfter ?? now, now, now]
  );
}

describe('job queue timestamps', () => {
  beforeEach(() => { run('DELETE FROM jobs'); });
  test('ISO run_after is due when compared to a later ISO now', () => {
    insertJob({ id: 'iso-due' });
    const job = nextQueuedJob('2026-09-09T16:50:00.000Z');
    assert.ok(job);
    assert.equal(job.id, 'iso-due');
  });

  test('ISO run_after is not due against sqlite datetime(now) format (the old bug)', () => {
    insertJob({ id: 'iso-sql-now', runAfter: '2026-09-09T16:46:30.041Z' });
    const withSqlNow = get(
      `SELECT id FROM jobs WHERE id = 'iso-sql-now' AND status = 'queued' AND run_after <= datetime('now')`
    );
    // datetime('now') is "YYYY-MM-DD HH:MM:SS"; space < "T", so this never matches
    assert.equal(withSqlNow, undefined);
    assert.equal(nextQueuedJob('2026-09-09T16:46:30.041Z')?.id, 'iso-sql-now');
  });

  test('future run_after stays queued', () => {
    insertJob({ id: 'future', runAfter: '2099-01-01T00:00:00.000Z' });
    assert.equal(nextQueuedJob('2026-09-09T16:50:00.000Z'), undefined);
  });

  test('markJobRunning claims the job so a second deploy is not 409-false-positive forever', () => {
    insertJob({ id: 'claim-me' });
    markJobRunning('claim-me', '2026-09-09T16:50:00.000Z');
    assert.equal(nextQueuedJob('2026-09-09T16:51:00.000Z'), undefined);
    const row = get('SELECT status, attempts FROM jobs WHERE id = ?', ['claim-me']);
    assert.equal(row.status, 'running');
    assert.equal(row.attempts, 1);
  });

  test('recoverStaleRunningJobs requeues so deploy can retry after worker restart', () => {
    insertJob({ id: 'stale', status: 'running' });
    recoverStaleRunningJobs('2026-09-09T17:00:00.000Z');
    const row = get('SELECT status FROM jobs WHERE id = ?', ['stale']);
    assert.equal(row.status, 'queued');
    assert.ok(nextQueuedJob('2026-09-09T17:00:00.000Z'));
  });
});
