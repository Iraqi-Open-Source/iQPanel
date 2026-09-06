const test = require('node:test');
const assert = require('node:assert/strict');
const metrics = require('../metrics');

test('parses memory usage from meminfo fixture', () => {
  const fixture = 'MemTotal:       8000000 kB\nMemAvailable:   4000000 kB\n';
  assert.equal(metrics.parseMeminfo(fixture), 50);
});

test('parses proc stat line', () => {
  const values = metrics.parseProcStat('cpu  100 0 50 200 0 0 0 0 0 0');
  assert.equal(values.length, 10);
  assert.equal(values[3], 200);
});
