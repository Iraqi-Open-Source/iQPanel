import { get, run } from '../data/db.js';

export function nowIso() {
  return new Date().toISOString();
}

/**
 * Jobs store run_after as ISO-8601 (`2026-09-09T16:46:30.041Z`).
 * SQLite datetime('now') is `2026-09-09 16:46:30` — string compare never
 * treats ISO values as due, so deploys stay queued forever.
 */
export function nextQueuedJob(now = nowIso()) {
  return get(
    `SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY created_at LIMIT 1`,
    [now]
  );
}

export function markJobRunning(id, now = nowIso()) {
  run(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`, [now, id]);
}

export function recoverStaleRunningJobs(now = nowIso()) {
  run(
    `UPDATE jobs SET status = 'queued', last_error = 'Worker restarted during job', updated_at = ? WHERE status = 'running'`,
    [now]
  );
}
