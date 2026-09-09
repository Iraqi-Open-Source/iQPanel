import { randomBytes } from 'node:crypto';
import { query, run } from '../data/db.js';
import { nowIso } from './jobs.js';

function uuid() { return randomBytes(16).toString('hex'); }

export function normalizeRecipeCmd(cmd) {
  const t = String(cmd ?? '').trim();
  if (/^cp\s+-n\s+\.env\.example\s+\.env$/.test(t)) {
    return 'test -f .env || cp .env.example .env';
  }
  return t;
}

export function createStep(deploymentId, { position, name, cmd = '', status = 'running' }) {
  const id = uuid();
  const now = nowIso();
  const started = status === 'running' ? now : null;
  const finished = status === 'skipped' ? now : null;
  run(
    `INSERT INTO deployment_steps (id,deployment_id,position,name,cmd,status,exit_code,output,started_at,finished_at)
     VALUES (?,?,?,?,?,?,NULL,'',?,?)`,
    [id, deploymentId, position, name, cmd, status, started, finished]
  );
  return id;
}

export function appendStepOutput(id, chunk) {
  if (!chunk) return;
  run(`UPDATE deployment_steps SET output = COALESCE(output,'') || ? WHERE id = ?`, [String(chunk), id]);
}

export function finishStep(id, { status, exit_code = null, extra = '' } = {}) {
  if (extra) appendStepOutput(id, extra);
  run(
    `UPDATE deployment_steps SET status = ?, exit_code = ?, finished_at = ? WHERE id = ?`,
    [status, exit_code, nowIso(), id]
  );
}

export function stepsForDeployment(deploymentId, { includeOutput = true } = {}) {
  if (includeOutput) {
    return query('SELECT * FROM deployment_steps WHERE deployment_id = ? ORDER BY position', [deploymentId]);
  }
  return query(
    `SELECT id,deployment_id,position,name,cmd,status,exit_code,started_at,finished_at,
            length(output) AS output_bytes
     FROM deployment_steps WHERE deployment_id = ? ORDER BY position`,
    [deploymentId]
  );
}

export function attachStepSummaries(deploys) {
  if (!deploys.length) return deploys;
  const ids = deploys.map((d) => d.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = query(
    `SELECT id,deployment_id,position,name,cmd,status,exit_code,started_at,finished_at
     FROM deployment_steps WHERE deployment_id IN (${placeholders}) ORDER BY position`,
    ids
  );
  const by = Object.create(null);
  for (const r of rows) (by[r.deployment_id] ??= []).push(r);
  return deploys.map((d) => ({ ...d, steps: by[d.id] ?? [] }));
}
