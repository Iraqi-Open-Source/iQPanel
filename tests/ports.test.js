const test = require('node:test');
const assert = require('node:assert/strict');
const { allocatePorts } = require('../ports');

test('allocates non-colliding ports after deletes', () => {
  const first = allocatePorts([]);
  const second = allocatePorts([{ port: first.port, app_port: first.app_port }]);
  assert.notEqual(second.port, first.port);
  assert.notEqual(second.app_port, first.app_port);
});
