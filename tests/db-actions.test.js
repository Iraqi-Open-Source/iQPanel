import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapEngineError,
  mysqlCreateSql,
  mysqlSetPasswordSql,
  postgresCreateSteps,
  postgresAdminArgs,
  postgresAdminCmd,
  postgresListArgs,
  mysqlEngineHealthArgs,
  postgresEngineHealthCmd,
  mysqlHealthArgs,
  postgresHealthArgs,
  create,
} from '../agent/actions/db.js';
import { resolveCreateCredentials, reasonFromEngineError } from '../server/domain/databases.js';

describe('resolveCreateCredentials (Plesk defaults)', () => {
  test('empty user becomes db name and empty password means generate', () => {
    const r = resolveCreateCredentials({ db_name: 'myapp' });
    assert.equal(r.dbName, 'myapp');
    assert.equal(r.dbUser, 'myapp');
    assert.equal(r.dbPass, null);
  });

  test('explicit user and password are kept', () => {
    const r = resolveCreateCredentials({ db_name: 'myapp', db_user: 'appuser', db_pass: 's3cretPass' });
    assert.equal(r.dbUser, 'appuser');
    assert.equal(r.dbPass, 's3cretPass');
  });

  test('rejects db name longer than 32 when user is empty', () => {
    assert.throws(
      () => resolveCreateCredentials({ db_name: 'a'.repeat(33) }),
      /shorter db_user/,
    );
  });

  test('rejects quotes in password', () => {
    assert.throws(
      () => resolveCreateCredentials({ db_name: 'myapp', db_pass: "o'reilly" }),
      /Invalid db_pass/,
    );
  });
});

describe('reasonFromEngineError', () => {
  test('maps socket auth', () => {
    assert.equal(
      reasonFromEngineError('MySQL root is not reachable via Unix socket as Linux root; restore socket auth or run the agent as root.'),
      'mysql_socket_auth',
    );
    assert.equal(reasonFromEngineError('ERROR 1698 (28000): Access denied'), 'mysql_socket_auth');
  });

  test('maps peer auth', () => {
    assert.equal(reasonFromEngineError('Peer authentication failed for user "postgres"'), 'postgres_peer_auth');
  });
});

describe('SQL / command builders', () => {
  test('MySQL SQL grants localhost and 127.0.0.1 and ALTERs password', () => {
    const sql = mysqlCreateSql({ dbName: 'shop', dbUser: 'shopu', dbPass: 'pw1' });
    assert.match(sql, /CREATE DATABASE IF NOT EXISTS `shop`/);
    assert.match(sql, /'shopu'@'localhost'/);
    assert.match(sql, /'shopu'@'127\.0\.0\.1'/);
    assert.match(sql, /ALTER USER 'shopu'@'localhost' IDENTIFIED BY 'pw1'/);
    assert.match(sql, /ALTER USER 'shopu'@'127\.0\.0\.1' IDENTIFIED BY 'pw1'/);
    assert.match(sql, /GRANT ALL PRIVILEGES ON `shop`\.\* TO 'shopu'@'localhost'/);
  });

  test('MySQL set-password SQL does not create the database', () => {
    const sql = mysqlSetPasswordSql({ dbName: 'shop', dbUser: 'shopu', dbPass: 'pw1' });
    assert.doesNotMatch(sql, /CREATE DATABASE/);
    assert.match(sql, /ALTER USER 'shopu'@'127\.0\.0\.1' IDENTIFIED BY 'pw1'/);
  });

  test('Postgres SQL includes OWNER and GRANT ON SCHEMA public', () => {
    const steps = postgresCreateSteps({ dbName: 'shop', dbUser: 'shopu', dbPass: 'pw1' });
    const joined = steps.map((s) => s.sql).join('\n');
    assert.match(joined, /ALTER ROLE "shopu" WITH PASSWORD 'pw1'/);
    assert.match(joined, /CREATE DATABASE "shop"/);
    assert.match(joined, /GRANT ALL PRIVILEGES ON DATABASE "shop" TO "shopu"/);
    assert.match(joined, /ALTER DATABASE "shop" OWNER TO "shopu"/);
    assert.equal(steps.at(-1).database, 'shop');
    assert.match(steps.at(-1).sql, /GRANT ALL ON SCHEMA public TO "shopu"/);
  });

  test('Postgres admin commands include runuser -u postgres', () => {
    const cmd = postgresAdminCmd('SELECT 1');
    assert.equal(cmd.file, 'runuser');
    assert.deepEqual(cmd.args.slice(0, 4), ['-u', 'postgres', '--', 'psql']);
    assert.ok(postgresAdminArgs('SELECT 1').includes('postgres'));
    const list = postgresListArgs();
    assert.equal(list[0], '-u');
    assert.equal(list[1], 'postgres');
    assert.ok(list.includes('-tAc'));
  });

  test('health helpers use 127.0.0.1 and SELECT 1', () => {
    const mysql = mysqlHealthArgs({ dbName: 'shop', dbUser: 'shopu', dbPass: 'pw1' });
    assert.equal(mysql.file, 'mysql');
    assert.ok(mysql.args.includes('127.0.0.1'));
    assert.ok(mysql.args.includes('SELECT 1'));
    assert.ok(mysql.args.includes('shop'));
    assert.ok(mysql.args.includes('-ushopu'));
    assert.ok(mysql.args.includes('-ppw1'));

    const pg = postgresHealthArgs({ dbName: 'shop', dbUser: 'shopu' });
    assert.equal(pg.file, 'psql');
    assert.ok(pg.args.includes('127.0.0.1'));
    assert.ok(pg.args.includes('SELECT 1'));
    assert.ok(pg.args.includes('shopu'));
  });

  test('engine health helpers', () => {
    assert.equal(mysqlEngineHealthArgs().file, 'mysqladmin');
    assert.deepEqual(mysqlEngineHealthArgs().args, ['ping']);
    const pg = postgresEngineHealthCmd();
    assert.equal(pg.file, 'runuser');
    assert.ok(pg.args.includes('SELECT 1'));
  });
});

describe('create.validate', () => {
  test('rejects invalid names', () => {
    assert.throws(() => create.validate({ engine: 'mysql', dbName: 'Bad-Name', dbUser: 'u' }), /Invalid db name/);
    assert.throws(() => create.validate({ engine: 'mysql', dbName: 'ok', dbUser: 'U' }), /Invalid db user/);
    assert.throws(() => create.validate({ engine: 'redis', dbName: 'ok', dbUser: 'ok' }), /Invalid engine/);
  });

  test('rejects quoted passwords', () => {
    assert.throws(() => create.validate({ engine: 'mysql', dbName: 'ok', dbUser: 'ok', dbPass: 'a"b' }), /Invalid db pass/);
  });
});

describe('mapEngineError', () => {
  test('maps 1698 to mysql_socket_auth', () => {
    const mapped = mapEngineError({ message: 'ERROR 1698 (28000): Access denied for user \'root\'@\'localhost\'' }, 'mysql');
    assert.equal(mapped.reason, 'mysql_socket_auth');
  });

  test('maps peer authentication', () => {
    const mapped = mapEngineError({ message: 'psql: error: Peer authentication failed for user "postgres"' }, 'postgres');
    assert.equal(mapped.reason, 'postgres_peer_auth');
  });
});
