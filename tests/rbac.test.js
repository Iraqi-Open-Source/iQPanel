import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hasRole, roleRank, canSeeUser } from '../server/http/rbac.js';

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

  test('admins do not see owner accounts', () => {
    const owner = { role: 'owner', email: 'admin@localhost' };
    const admin = { role: 'admin', email: 'ops@localhost' };
    assert.equal(canSeeUser({ role: 'admin' }, owner), false);
    assert.equal(canSeeUser({ role: 'admin' }, admin), true);
    assert.equal(canSeeUser({ role: 'owner' }, owner), true);
    assert.equal(canSeeUser({ role: 'operator' }, owner), false);
  });

  test('handles invalid roles', () => {
    assert.ok(!hasRole('nobody', 'readonly'));
    assert.ok(!hasRole(null, 'readonly'));
  });
});
