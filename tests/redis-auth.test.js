import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRedisAuth } from '../agent/actions/redis.js';

test('parseRedisAuth ignores commented requirepass', () => {
  const parsed = parseRedisAuth('# requirepass secret\nport 6379\n');
  assert.equal(parsed.password, null);
});

test('parseRedisAuth reads requirepass', () => {
  const parsed = parseRedisAuth('port 6379\nrequirepass hunter2\n');
  assert.equal(parsed.password, 'hunter2');
});

test('parseRedisAuth reads quoted requirepass and strips trailing comments', () => {
  const parsed = parseRedisAuth('requirepass "p@ss word"\nrequirepass plain # note\n');
  assert.equal(parsed.password, 'plain');
  assert.equal(parseRedisAuth('requirepass "p@ss word"\n').password, 'p@ss word');
});

test('parseRedisAuth reads ACL default user password and nopass', () => {
  assert.equal(parseRedisAuth('user default on >s3cret ~* &* +@all\n').password, 's3cret');
  assert.equal(parseRedisAuth('user default on >s3cret ~* &* +@all\nuser default on nopass ~* &* +@all\n').password, null);
});

test('parseRedisAuth collects include paths', () => {
  const parsed = parseRedisAuth('include /etc/redis/local.conf\nincludefile "/etc/redis/users.acl"\n');
  assert.deepEqual(parsed.includes, ['/etc/redis/local.conf', '/etc/redis/users.acl']);
});
