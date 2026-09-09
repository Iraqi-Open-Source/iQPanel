import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function mysqlExec(sql, opts = {}) {
  const args = ['--batch', '--silent', '-e', sql];
  if (opts.user) args.unshift(`-u${opts.user}`);
  if (opts.password) args.unshift(`-p${opts.password}`);
  return execFileSync('mysql', args, { encoding: 'utf8' });
}

function psqlExec(sql, opts = {}) {
  const env = { ...process.env };
  if (opts.password) env.PGPASSWORD = opts.password;
  return execFileSync('psql', ['-U', opts.user ?? 'postgres', '-c', sql], { encoding: 'utf8', env });
}

function detectSocket(engine) {
  const sockets = {
    mysql:   ['/var/run/mysqld/mysqld.sock', '/tmp/mysql.sock'],
    mariadb: ['/var/run/mysqld/mysqld.sock', '/run/mysqld/mysqld.sock'],
    postgres:['/var/run/postgresql/.s.PGSQL.5432', '/run/postgresql/.s.PGSQL.5432'],
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
      ['mysql',    ['mysql'],   'mysql'],
      ['mariadb',  ['mysql'],   'mariadb'],
      ['postgres', ['psql'],    'postgres'],
      ['redis',    ['redis-cli'], null],
    ]) {
      const installed = bins.every(binaryExists);
      let active = false;
      try {
        const s = execFileSync('systemctl', ['is-active', engine === 'mariadb' ? 'mariadb' : engine === 'mysql' ? 'mysql' : engine === 'postgres' ? 'postgresql' : 'redis-server'], { encoding: 'utf8' }).trim();
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

export const create = {
  validate({ engine, dbName, dbUser }) {
    if (!['mysql','mariadb','postgres'].includes(engine)) throw new Error('Invalid engine');
    if (!/^[a-z0-9_]{1,64}$/.test(dbName)) throw new Error('Invalid db name');
    if (!/^[a-z0-9_]{1,32}$/.test(dbUser)) throw new Error('Invalid db user');
  },
  async run({ engine, dbName, dbUser, dbPass }) {
    const pw = dbPass ?? randomPw();
    if (engine === 'mysql' || engine === 'mariadb') {
      mysqlExec(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
      mysqlExec(`CREATE USER IF NOT EXISTS '${dbUser}'@'localhost' IDENTIFIED BY '${pw}';`);
      mysqlExec(`GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUser}'@'localhost'; FLUSH PRIVILEGES;`);
    } else {
      psqlExec(`CREATE DATABASE "${dbName}";`);
      psqlExec(`CREATE USER "${dbUser}" WITH PASSWORD '${pw}';`);
      psqlExec(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${dbUser}";`);
    }
    return { engine, dbName, dbUser, dbPass: pw };
  },
};

export const drop = {
  validate({ engine, dbName, dbUser }) {
    if (!['mysql','mariadb','postgres'].includes(engine)) throw new Error('Invalid engine');
    if (!/^[a-z0-9_]{1,64}$/.test(dbName)) throw new Error('Invalid db name');
    if (dbUser && !/^[a-z0-9_]{1,32}$/.test(dbUser)) throw new Error('Invalid db user');
  },
  async run({ engine, dbName, dbUser }) {
    if (engine === 'mysql' || engine === 'mariadb') {
      try { mysqlExec(`DROP DATABASE IF EXISTS \`${dbName}\`;`); } catch {}
      if (dbUser) try { mysqlExec(`DROP USER IF EXISTS '${dbUser}'@'localhost'; FLUSH PRIVILEGES;`); } catch {}
    } else {
      if (dbUser) try { psqlExec(`REVOKE ALL ON DATABASE "${dbName}" FROM "${dbUser}";`); } catch {}
      try { psqlExec(`DROP DATABASE IF EXISTS "${dbName}";`); } catch {}
      if (dbUser) try { psqlExec(`DROP USER IF EXISTS "${dbUser}";`); } catch {}
    }
    return { dropped: dbName };
  },
};

export const dump = {
  timeout: 300_000,
  validate({ engine, dbName, dest }) {
    if (!['mysql','mariadb','postgres'].includes(engine)) throw new Error('Invalid engine');
    if (!/^[a-z0-9_]{1,64}$/.test(dbName)) throw new Error('Invalid db name');
    if (!dest || !dest.startsWith('/var/backups/panel/')) throw new Error('dest must be under /var/backups/panel/');
  },
  async run({ engine, dbName, dest }, emit) {
    emit?.('stdout', `Dumping ${dbName} to ${dest}\n`);
    if (engine === 'mysql' || engine === 'mariadb') {
      execFileSync('mysqldump', ['--single-transaction', '--routines', dbName, '--result-file', dest], { encoding: 'utf8' });
    } else {
      execFileSync('pg_dump', ['-U', 'postgres', '-Fc', '-f', dest, dbName], { encoding: 'utf8' });
    }
    return { dest };
  },
};

export const list = {
  async run({ engine }) {
    if (engine === 'mysql' || engine === 'mariadb') {
      return mysqlExec('SHOW DATABASES;').split('\n').filter(Boolean);
    } else if (engine === 'postgres') {
      return psqlExec("SELECT datname FROM pg_database WHERE datistemplate=false;").split('\n').slice(2,-1).map(s=>s.trim()).filter(Boolean);
    }
    return [];
  },
};
