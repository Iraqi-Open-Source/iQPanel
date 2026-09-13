import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const SQL_ENGINES = new Set(['mysql', 'mariadb', 'postgres']);
const HEALTH_ENGINES = new Set(['mysql', 'mariadb', 'postgres', 'redis']);
const DB_PASS_MAX = 128;
const DB_PASS_BAD = /['"\\\x00-\x1f\x7f]/;

export function mapEngineError(err, engine) {
  const text = [err?.message, err?.stderr, err?.stdout].filter(Boolean).join('\n');
  if (engine === 'mysql' || engine === 'mariadb') {
    if (/\b1698\b/.test(text) || /\b1045\b/.test(text) || /Access denied/i.test(text)) {
      const mapped = new Error('MySQL root is not reachable via Unix socket as Linux root; restore socket auth or run the agent as root.');
      mapped.reason = 'mysql_socket_auth';
      return mapped;
    }
  }
  if (engine === 'postgres' && /peer authentication/i.test(text)) {
    const mapped = new Error('PostgreSQL peer authentication failed. The agent must run psql as the postgres OS user.');
    mapped.reason = 'postgres_peer_auth';
    return mapped;
  }
  return err instanceof Error ? err : new Error(String(err));
}

export function mysqlCreateSql({ dbName, dbUser, dbPass }) {
  return [
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\``,
    `CREATE USER IF NOT EXISTS '${dbUser}'@'localhost' IDENTIFIED BY '${dbPass}'`,
    `CREATE USER IF NOT EXISTS '${dbUser}'@'127.0.0.1' IDENTIFIED BY '${dbPass}'`,
    `ALTER USER '${dbUser}'@'localhost' IDENTIFIED BY '${dbPass}'`,
    `ALTER USER '${dbUser}'@'127.0.0.1' IDENTIFIED BY '${dbPass}'`,
    `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUser}'@'localhost'`,
    `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUser}'@'127.0.0.1'`,
    'FLUSH PRIVILEGES',
  ].join('; ') + ';';
}

export function postgresCreateSteps({ dbName, dbUser, dbPass }) {
  return [
    {
      database: 'postgres',
      sql: `DO $do$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${dbUser}') THEN CREATE ROLE "${dbUser}" LOGIN PASSWORD '${dbPass}'; ELSE ALTER ROLE "${dbUser}" WITH PASSWORD '${dbPass}'; END IF; END $do$;`,
    },
    { database: 'postgres', sql: `CREATE DATABASE "${dbName}"` },
    { database: 'postgres', sql: `GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${dbUser}"` },
    { database: 'postgres', sql: `ALTER DATABASE "${dbName}" OWNER TO "${dbUser}"` },
    { database: dbName, sql: `GRANT ALL ON SCHEMA public TO "${dbUser}"` },
  ];
}

export function postgresAdminArgs(sql, database = 'postgres') {
  return ['-u', 'postgres', '--', 'psql', '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', sql];
}

export function postgresAdminCmd(sql, database = 'postgres') {
  return { file: 'runuser', args: postgresAdminArgs(sql, database) };
}

export function postgresListArgs() {
  return ['-u', 'postgres', '--', 'psql', '-d', 'postgres', '-tAc', 'SELECT datname FROM pg_database WHERE datistemplate = false;'];
}

export function mysqlEngineHealthArgs() {
  return { file: 'mysqladmin', args: ['ping'] };
}

export function postgresEngineHealthCmd() {
  return postgresAdminCmd('SELECT 1');
}

export function mysqlHealthArgs({ dbName, dbUser, dbPass }) {
  return {
    file: 'mysql',
    args: ['-h', '127.0.0.1', `-u${dbUser}`, `-p${dbPass}`, '--batch', '--silent', '-e', 'SELECT 1', dbName],
  };
}

export function postgresHealthArgs({ dbName, dbUser }) {
  return {
    file: 'psql',
    args: ['-h', '127.0.0.1', '-U', dbUser, '-d', dbName, '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 1'],
  };
}

function mysqlExec(sql, opts = {}) {
  const args = ['--batch', '--silent', '-e', sql];
  if (opts.user) args.unshift(`-u${opts.user}`);
  if (opts.password) args.unshift(`-p${opts.password}`);
  try {
    return execFileSync('mysql', args, { encoding: 'utf8' });
  } catch (e) {
    throw mapEngineError(e, opts.engine ?? 'mysql');
  }
}

function psqlAdmin(sql, database = 'postgres') {
  const cmd = postgresAdminCmd(sql, database);
  try {
    return execFileSync(cmd.file, cmd.args, { encoding: 'utf8' });
  } catch (e) {
    throw mapEngineError(e, 'postgres');
  }
}

function detectSocket(engine) {
  const sockets = {
    mysql:    ['/var/run/mysqld/mysqld.sock', '/tmp/mysql.sock'],
    mariadb:  ['/var/run/mysqld/mysqld.sock', '/run/mysqld/mysqld.sock'],
    postgres: ['/var/run/postgresql/.s.PGSQL.5432', '/run/postgresql/.s.PGSQL.5432'],
  };
  return (sockets[engine] ?? []).some(existsSync);
}

function binaryExists(bin) {
  const r = spawnSync('which', [bin], { encoding: 'utf8' });
  return r.status === 0;
}

export const engines = {
  async run() {
    const result = {};
    for (const [engine, bins, sock] of [
      ['mysql',    ['mysql'],     'mysql'],
      ['mariadb',  ['mysql'],     'mariadb'],
      ['postgres', ['psql'],      'postgres'],
      ['redis',    ['redis-cli'], null],
    ]) {
      const installed = bins.every(binaryExists);
      let active = false;
      try {
        const unit = engine === 'mariadb' ? 'mariadb'
          : engine === 'mysql' ? 'mysql'
            : engine === 'postgres' ? 'postgresql'
              : 'redis-server';
        const s = execFileSync('systemctl', ['is-active', unit], { encoding: 'utf8' }).trim();
        active = s === 'active';
      } catch {}
      result[engine] = { installed, active, socket: sock ? detectSocket(sock) : false };
    }
    return result;
  },
};

function randomPw() {
  return execFileSync('openssl', ['rand', '-base64', '18'], { encoding: 'utf8' }).trim().replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
}

function assertDbPass(dbPass) {
  if (dbPass == null || dbPass === '') return;
  if (typeof dbPass !== 'string' || dbPass.length > DB_PASS_MAX || DB_PASS_BAD.test(dbPass)) {
    throw new Error('Invalid db pass');
  }
}

export const create = {
  validate({ engine, dbName, dbUser, dbPass }) {
    if (!SQL_ENGINES.has(engine)) throw new Error('Invalid engine');
    if (!/^[a-z0-9_]{1,64}$/.test(dbName)) throw new Error('Invalid db name');
    if (!/^[a-z0-9_]{1,32}$/.test(dbUser)) throw new Error('Invalid db user');
    assertDbPass(dbPass);
  },
  async run({ engine, dbName, dbUser, dbPass }) {
    const pw = dbPass == null || dbPass === '' ? randomPw() : dbPass;
    if (engine === 'mysql' || engine === 'mariadb') {
      mysqlExec(mysqlCreateSql({ dbName, dbUser, dbPass: pw }), { engine });
    } else {
      for (const step of postgresCreateSteps({ dbName, dbUser, dbPass: pw })) {
        psqlAdmin(step.sql, step.database);
      }
    }
    return { engine, dbName, dbUser, dbPass: pw };
  },
};

export const drop = {
  validate({ engine, dbName, dbUser }) {
    if (!SQL_ENGINES.has(engine)) throw new Error('Invalid engine');
    if (!/^[a-z0-9_]{1,64}$/.test(dbName)) throw new Error('Invalid db name');
    if (dbUser && !/^[a-z0-9_]{1,32}$/.test(dbUser)) throw new Error('Invalid db user');
  },
  async run({ engine, dbName, dbUser }) {
    if (engine === 'mysql' || engine === 'mariadb') {
      try { mysqlExec(`DROP DATABASE IF EXISTS \`${dbName}\`;`, { engine }); } catch {}
      if (dbUser) {
        try { mysqlExec(`DROP USER IF EXISTS '${dbUser}'@'localhost'; DROP USER IF EXISTS '${dbUser}'@'127.0.0.1'; FLUSH PRIVILEGES;`, { engine }); } catch {}
      }
    } else {
      if (dbUser) try { psqlAdmin(`REVOKE ALL ON DATABASE "${dbName}" FROM "${dbUser}"`); } catch {}
      try { psqlAdmin(`DROP DATABASE IF EXISTS "${dbName}"`); } catch {}
      if (dbUser) try { psqlAdmin(`DROP USER IF EXISTS "${dbUser}"`); } catch {}
    }
    return { dropped: dbName };
  },
};

export const dump = {
  timeout: 300_000,
  validate({ engine, dbName, dest }) {
    if (!SQL_ENGINES.has(engine)) throw new Error('Invalid engine');
    if (!/^[a-z0-9_]{1,64}$/.test(dbName)) throw new Error('Invalid db name');
    if (!dest || !dest.startsWith('/var/backups/panel/')) throw new Error('dest must be under /var/backups/panel/');
  },
  async run({ engine, dbName, dest }, emit) {
    emit?.('stdout', `Dumping ${dbName} to ${dest}\n`);
    try {
      if (engine === 'mysql' || engine === 'mariadb') {
        execFileSync('mysqldump', ['--single-transaction', '--routines', dbName, '--result-file', dest], { encoding: 'utf8' });
      } else {
        execFileSync('runuser', ['-u', 'postgres', '--', 'pg_dump', '-Fc', '-f', dest, dbName], { encoding: 'utf8' });
      }
    } catch (e) {
      throw mapEngineError(e, engine === 'postgres' ? 'postgres' : 'mysql');
    }
    return { dest };
  },
};

const SYSTEM_DATABASES = new Set([
  'information_schema', 'mysql', 'performance_schema', 'sys', 'sys_cluster',
  'postgres', 'template0', 'template1',
]);

export const list = {
  validate({ engine }) {
    if (!SQL_ENGINES.has(engine)) throw new Error('Invalid engine');
  },
  async run({ engine }) {
    let names = [];
    if (engine === 'mysql' || engine === 'mariadb') {
      names = mysqlExec('SHOW DATABASES;', { engine }).split('\n').map((s) => s.trim()).filter(Boolean);
    } else {
      try {
        names = execFileSync('runuser', postgresListArgs(), { encoding: 'utf8' })
          .split('\n').map((s) => s.trim()).filter(Boolean);
      } catch (e) {
        throw mapEngineError(e, 'postgres');
      }
    }
    return names.filter((n) => !SYSTEM_DATABASES.has(n));
  },
};

function healthFail(err) {
  const message = String(err?.stderr || err?.message || err || 'health check failed').trim();
  return { ok: false, error: message.split('\n')[0].slice(0, 300) };
}

export const engineHealth = {
  validate({ engine }) {
    if (!HEALTH_ENGINES.has(engine)) throw new Error('Invalid engine');
  },
  async run({ engine }) {
    try {
      if (engine === 'redis') {
        const pong = execFileSync('redis-cli', ['PING'], { encoding: 'utf8' }).trim();
        return pong === 'PONG' ? { ok: true } : { ok: false, error: pong || 'unexpected PING response' };
      }
      if (engine === 'postgres') {
        const cmd = postgresEngineHealthCmd();
        execFileSync(cmd.file, cmd.args, { encoding: 'utf8' });
        return { ok: true };
      }
      const cmd = mysqlEngineHealthArgs();
      execFileSync(cmd.file, cmd.args, { encoding: 'utf8' });
      return { ok: true };
    } catch (e) {
      return healthFail(e);
    }
  },
};

export const health = {
  validate({ engine, dbName, dbUser, dbPass }) {
    if (!SQL_ENGINES.has(engine)) throw new Error('Invalid engine');
    if (!/^[a-z0-9_]{1,64}$/.test(dbName)) throw new Error('Invalid db name');
    if (!/^[a-z0-9_]{1,32}$/.test(dbUser)) throw new Error('Invalid db user');
    if (!dbPass) throw new Error('db pass required');
    assertDbPass(dbPass);
  },
  async run({ engine, dbName, dbUser, dbPass }) {
    try {
      if (engine === 'postgres') {
        const cmd = postgresHealthArgs({ dbName, dbUser });
        execFileSync(cmd.file, cmd.args, {
          encoding: 'utf8',
          env: { ...process.env, PGPASSWORD: dbPass },
        });
      } else {
        const cmd = mysqlHealthArgs({ dbName, dbUser, dbPass });
        execFileSync(cmd.file, cmd.args, { encoding: 'utf8' });
      }
      return { ok: true };
    } catch (e) {
      return healthFail(e);
    }
  },
};
