/**
 * Recipe command normalization and per-step deploy log persistence.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExecScript } from '../agent/actions/exec.js';

process.env.PANEL_DATA_ROOT = mkdtempSync(join(tmpdir(), 'iqpanel-dsteps-'));
process.env.PANEL_SECRET_KEY = 'test-secret-key-for-tests-only-32';

const { run, get } = await import('../server/data/db.js');
const {
  normalizeRecipeCmd, createStep, appendStepOutput, finishStep,
  stepsForDeployment, attachStepSummaries,
} = await import('../server/domain/deploy-steps.js');

describe('exec working directory', () => {
  test('script cds into app relative to the site home', () => {
    assert.equal(
      buildExecScript('composer install --no-interaction'),
      'cd app && composer install --no-interaction'
    );
  });
});

describe('recipe commands', () => {
  test('rewrites GNU cp -n env copy so a second deploy is not a failure', () => {
    assert.equal(
      normalizeRecipeCmd('cp -n .env.example .env'),
      'test -f .env || cp .env.example .env'
    );
  });
});

describe('deployment steps', () => {
  beforeEach(() => {
    run('DELETE FROM deployment_steps');
    run('DELETE FROM deployments');
    run('DELETE FROM sites');
    const now = '2026-09-09T17:00:00.000Z';
    run(`INSERT INTO sites (id,name,slug,type,php_version,webserver,run_as_user,directory,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ['s1', 'App', 'app', 'laravel', '8.4', 'nginx', '', '', 'online', now, now]);
    run(`INSERT INTO deployments (id,site_id,status,log_path,triggered_by,created_at)
         VALUES (?,?,?,?,?,?)`,
      ['d1', 's1', 'running', '/tmp/d1.log', 'admin', now]);
  });

  test('stores command output for later inspection', () => {
    const id = createStep('d1', { position: 0, name: 'composer install', cmd: 'composer install' });
    appendStepOutput(id, 'Installing dependencies\n');
    appendStepOutput(id, 'Generating autoload\n');
    finishStep(id, { status: 'success', exit_code: 0 });
    const [step] = stepsForDeployment('d1');
    assert.equal(step.status, 'success');
    assert.match(step.output, /Installing dependencies/);
    assert.match(step.output, /Generating autoload/);
    assert.equal(step.exit_code, 0);
  });

  test('list payload includes step summaries without output', () => {
    createStep('d1', { position: 0, name: 'Clone repository', cmd: 'git clone', status: 'success' });
    const deploys = attachStepSummaries([get('SELECT * FROM deployments WHERE id = ?', ['d1'])]);
    assert.equal(deploys[0].steps.length, 1);
    assert.equal(deploys[0].steps[0].name, 'Clone repository');
    assert.equal(deploys[0].steps[0].output, undefined);
  });
});
