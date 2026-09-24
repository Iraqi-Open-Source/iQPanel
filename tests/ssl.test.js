import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { issue, issueArgs } from '../agent/actions/ssl.js';

describe('ssl issue', () => {
  test('omits the contact email when none is given', () => {
    assert.deepEqual(issueArgs({ domain: 'app.example.com', nginx: true }), [
      'certonly', '--non-interactive', '--agree-tos', '-d', 'app.example.com',
      '--register-unsafely-without-email', '--nginx',
    ]);
    assert.doesNotThrow(() => issue.validate({ domain: 'app.example.com' }));
    assert.doesNotThrow(() => issue.validate({ domain: 'app.example.com', email: '  ' }));
  });

  test('passes a contact email when one is given', () => {
    assert.deepEqual(issueArgs({ domain: 'app.example.com', email: 'admin@example.com', nginx: true }), [
      'certonly', '--non-interactive', '--agree-tos', '-d', 'app.example.com',
      '-m', 'admin@example.com', '--nginx',
    ]);
  });

  test('rejects a malformed email', () => {
    assert.throws(() => issue.validate({ domain: 'app.example.com', email: 'not-an-email' }), /Invalid email/);
  });
});
