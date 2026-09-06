const crypto = require('node:crypto');
const db = require('./db');

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

function enqueue(type, payload, options = {}) {
  const jobId = id();
  const created = now();
  db.run(`INSERT INTO jobs (id,type,payload,status,attempts,max_attempts,last_error,result,run_after,created_at,updated_at) VALUES (${db.sql(jobId)},${db.sql(type)},${db.sql(JSON.stringify(payload || {}))},'queued',0,${Number(options.maxAttempts || 3)},'','',${db.sql(created)},${db.sql(created)},${db.sql(created)})`);
  return get(jobId);
}

function get(jobId) {
  return db.rows(`SELECT * FROM jobs WHERE id=${db.sql(jobId)} LIMIT 1`)[0] || null;
}

function claim() {
  const job = db.rows(`SELECT * FROM jobs WHERE status='queued' AND run_after<=${db.sql(now())} ORDER BY created_at ASC LIMIT 1`)[0];
  if (!job) return null;
  db.run(`UPDATE jobs SET status='running', attempts=attempts+1, updated_at=${db.sql(now())} WHERE id=${db.sql(job.id)} AND status='queued'`);
  const claimed = get(job.id);
  if (!claimed || claimed.status !== 'running') return null;
  return claimed;
}

function complete(jobId, result) {
  db.run(`UPDATE jobs SET status='succeeded', result=${db.sql(JSON.stringify(result ?? {}))}, updated_at=${db.sql(now())} WHERE id=${db.sql(jobId)}`);
  return get(jobId);
}

function fail(jobId, message) {
  const job = get(jobId);
  if (!job) throw new Error('Job not found');
  const status = job.attempts >= job.max_attempts ? 'failed' : 'queued';
  db.run(`UPDATE jobs SET status=${db.sql(status)}, last_error=${db.sql(message)}, run_after=${db.sql(now())}, updated_at=${db.sql(now())} WHERE id=${db.sql(jobId)}`);
  return get(jobId);
}

module.exports = { enqueue, get, claim, complete, fail };
