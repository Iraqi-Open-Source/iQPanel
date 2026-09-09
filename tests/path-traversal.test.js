/**
 * Path traversal checks on the files action.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set up a fake SITES_ROOT
const tmpRoot = mkdtempSync(join(tmpdir(), 'iqpanel-sites-'));
process.env.PANEL_SITES_ROOT = tmpRoot;

// Create test site directory
const slug = 'testsite';
const appDir = join(tmpRoot, slug, 'app');
mkdirSync(appDir, { recursive: true });
writeFileSync(join(appDir, 'ok.txt'), 'hello');

const { list, read, write: writeFile } = await import('../agent/actions/files.js');

describe('File path traversal', () => {
  test('reads file in allowed directory', async () => {
    const result = await read.run({ slug, path: 'ok.txt' });
    assert.equal(result.content, 'hello');
  });

  test('denies traversal above app root', async () => {
    await assert.rejects(
      () => read.run({ slug, path: '../../../etc/passwd' }),
      /traversal/i,
    );
  });

  test('denies traversal with absolute path escape', async () => {
    await assert.rejects(
      () => read.run({ slug, path: '/etc/passwd' }),
      /traversal/i,
    );
  });

  test('denies invalid slug', async () => {
    await assert.rejects(
      () => read.run({ slug: '../etc', path: 'ok.txt' }),
      /Invalid slug/i,
    );
  });

  test('list works on valid path', async () => {
    const entries = await list.run({ slug, path: '.' });
    assert.ok(Array.isArray(entries));
    assert.ok(entries.some((e) => e.name === 'ok.txt'));
  });
});
