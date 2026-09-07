const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-reinstall-'));
const resetScript = path.join(__dirname, '..', 'installer', 'reset-admin-password.js');
const dbPath = path.join(dataRoot, 'panel.sqlite');

function hash(password) {
  return crypto.scryptSync(password, 'iqpanel-admin', 32).toString('hex');
}

function resetPassword(password) {
  const result = spawnSync(process.execPath, [resetScript], {
    env: {
      ...process.env,
      PANEL_DATA_ROOT: dataRoot,
      PANEL_ADMIN_PASSWORD_HASH: hash(password),
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}

test('reinstall resets the persisted admin password hash', () => {
  resetPassword('first-password');
  spawnSync('sqlite3', [dbPath, "UPDATE users SET failed_2fa=5, locked_until='2099-01-01T00:00:00.000Z'"]);

  resetPassword('second-password');

  const result = spawnSync('sqlite3', ['-json', dbPath, 'SELECT password_hash, failed_2fa, locked_until FROM users WHERE email=\'admin\''], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const [admin] = JSON.parse(result.stdout);
  assert.equal(admin.password_hash, hash('second-password'));
  assert.equal(admin.failed_2fa, 0);
  assert.equal(admin.locked_until, null);
});
