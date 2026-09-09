/**
 * node:sqlite has no db.transaction(); the helper must BEGIN/COMMIT/ROLLBACK.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PANEL_DATA_ROOT = mkdtempSync(join(tmpdir(), 'iqpanel-db-'));
process.env.PANEL_SECRET_KEY = 'test-secret-key-for-tests-only-32';

const { run, get, transaction, exec } = await import('../server/data/db.js');

describe('transaction', () => {
  test('is a function (not db.transaction from better-sqlite3)', () => {
    assert.equal(typeof transaction, 'function');
  });

  test('commits writes', () => {
    exec('CREATE TABLE IF NOT EXISTS tx_demo (id TEXT PRIMARY KEY, n INTEGER)');
    transaction(() => {
      run('INSERT INTO tx_demo (id, n) VALUES (?, ?)', ['a', 1]);
    });
    assert.equal(get('SELECT n FROM tx_demo WHERE id = ?', ['a']).n, 1);
  });

  test('rolls back on throw', () => {
    exec('CREATE TABLE IF NOT EXISTS tx_demo (id TEXT PRIMARY KEY, n INTEGER)');
    assert.throws(() => {
      transaction(() => {
        run('INSERT INTO tx_demo (id, n) VALUES (?, ?)', ['b', 2]);
        throw new Error('boom');
      });
    }, /boom/);
    assert.equal(get('SELECT n FROM tx_demo WHERE id = ?', ['b']), undefined);
  });

  test('inserts a site row the way POST /api/sites does (auto port)', () => {
    const now = new Date().toISOString();
    transaction(() => {
      run(`INSERT INTO sites (id,name,slug,type,repo_url,domain,port,php_version,webserver,run_as_user,directory,status,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,'','','provisioning',?,?)`,
        ['id1', 'My App', 'my-app', 'laravel', 'git@github.com:org/repo.git', null, 8000, '8.4', 'nginx', now, now]);
    });
    const site = get('SELECT * FROM sites WHERE slug = ?', ['my-app']);
    assert.equal(site.type, 'laravel');
    assert.equal(site.php_version, '8.4');
    assert.equal(site.repo_url, 'git@github.com:org/repo.git');
    assert.equal(Number(site.port), 8000);
    assert.equal(site.domain, null);
    JSON.stringify(site); // must not throw (BigInt would)
  });
});
