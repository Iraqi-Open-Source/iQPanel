const DB_NAME_RE = /^[a-z0-9_]{1,64}$/;
const DB_USER_RE = /^[a-z0-9_]{1,32}$/;
const DB_PASS_MAX = 128;
const DB_PASS_BAD = /['"\\\x00-\x1f\x7f]/;

export function reasonFromEngineError(message) {
  const msg = String(message ?? '');
  if (/Unix socket as Linux root/i.test(msg) || /\b1698\b/.test(msg) || /\b1045\b/.test(msg)) {
    return 'mysql_socket_auth';
  }
  if (/peer authentication/i.test(msg)) return 'postgres_peer_auth';
  return undefined;
}

/**
 * Plesk-style defaults: required db name; empty user becomes the db name;
 * empty password means the agent should generate one (returned as dbPass: null).
 */
export function resolveCreateCredentials({ db_name, db_user, db_pass } = {}) {
  const dbName = String(db_name ?? '').trim();
  if (!dbName || !DB_NAME_RE.test(dbName)) {
    const err = new Error('Invalid db_name (a-z0-9_, 1-64 chars)');
    err.status = 400;
    throw err;
  }

  const rawUser = String(db_user ?? '').trim();
  if (!rawUser && dbName.length > 32) {
    const err = new Error('db_name is longer than 32 characters; specify a shorter db_user');
    err.status = 400;
    throw err;
  }
  const dbUser = rawUser || dbName;
  if (!DB_USER_RE.test(dbUser)) {
    const err = new Error('Invalid db_user (a-z0-9_, 1-32 chars)');
    err.status = 400;
    throw err;
  }

  const rawPass = db_pass == null ? '' : String(db_pass);
  let dbPass = rawPass === '' ? null : rawPass;
  if (dbPass != null && (dbPass.length > DB_PASS_MAX || DB_PASS_BAD.test(dbPass))) {
    const err = new Error('Invalid db_pass (no quotes or control characters, max 128)');
    err.status = 400;
    throw err;
  }

  return { dbName, dbUser, dbPass };
}

export function assertOptionalDbPass(db_pass) {
  if (db_pass == null || db_pass === '') return '';
  const raw = String(db_pass);
  if (raw.length > DB_PASS_MAX || DB_PASS_BAD.test(raw)) {
    const err = new Error('Invalid db_pass (no quotes or control characters, max 128)');
    err.status = 400;
    throw err;
  }
  return raw;
}
