import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hasRole, roleRank } from '../server/http/rbac.js';

describe('RBAC', () => {
  test('role ranks are ordered correctly', () => {
    assert.ok(roleRank('owner')    > roleRank('admin'));
    assert.ok(roleRank('admin')    > roleRank('operator'));
    assert.ok(roleRank('operator') > roleRank('readonly'));
    assert.ok(roleRank('readonly') > 0);
  });

  test('hasRole checks access', () => {
    assert.ok(hasRole('owner',    'admin'));
    assert.ok(hasRole('admin',    'operator'));
    assert.ok(hasRole('operator', 'readonly'));
    assert.ok(!hasRole('readonly', 'operator'));
    assert.ok(!hasRole('operator', 'admin'));
    assert.ok(!hasRole('admin',    'owner'));
  });

  test('accepts user objects', () => {
    assert.ok(hasRole({ role: 'admin' }, 'operator'));
    assert.ok(!hasRole({ role: 'readonly' }, 'admin'));
  });

  test('handles invalid roles', () => {
    assert.ok(!hasRole('nobody', 'readonly'));
    assert.ok(!hasRole(null, 'readonly'));
  });
});
