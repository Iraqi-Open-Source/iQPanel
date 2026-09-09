import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { commandNeedsReauth, SHORTCUT_ALLOWLIST, DESTRUCTIVE_COMMANDS } from '../server/http/command-policy.js';

describe('command reauth policy', () => {
  test('allowlisted artisan shortcuts do not require reauth', () => {
    assert.equal(commandNeedsReauth('php artisan migrate:status'), false);
    assert.equal(commandNeedsReauth('php artisan migrate'), false);
    assert.equal(commandNeedsReauth('php artisan optimize:clear'), false);
    assert.equal(commandNeedsReauth('  php artisan cache:clear  '), false);
  });

  test('destructive shortcuts require reauth', () => {
    assert.equal(commandNeedsReauth('php artisan migrate:fresh'), true);
    assert.equal(commandNeedsReauth('php artisan migrate:rollback'), true);
    for (const cmd of DESTRUCTIVE_COMMANDS) {
      assert.ok(SHORTCUT_ALLOWLIST.has(cmd), `${cmd} should stay in the allowlist`);
    }
  });

  test('arbitrary shell requires reauth', () => {
    assert.equal(commandNeedsReauth('rm -rf /'), true);
    assert.equal(commandNeedsReauth('php artisan tinker'), true);
    assert.equal(commandNeedsReauth(''), true);
  });
});
