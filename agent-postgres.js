const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { renderTemplate } = require('./template');
const { root } = require('./db');

function postgresIdent(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(String(value || ''))) throw new Error('Invalid PostgreSQL identifier');
  return String(value);
}

function postgresSocket() {
  const dir = ['/var/run/postgresql', '/run/postgresql', '/tmp'].find((candidate) => fs.existsSync(path.join(candidate, '.s.PGSQL.5432')));
  return dir ? path.join(dir, '.s.PGSQL.5432') : null;
}

function postgresCreateStatements(mode, databaseName, databaseUser, secret) {
  if (mode === 'attach') return '';
  const escaped = String(secret).replaceAll("'", "''");
  return `CREATE USER ${databaseUser} WITH PASSWORD '${escaped}';\nCREATE DATABASE ${databaseName} OWNER ${databaseUser};\n`;
}

async function provisionPostgres({ db_name, db_user, password, mode = 'create' }, command) {
  const databaseName = postgresIdent(db_name);
  const databaseUser = postgresIdent(db_user);
  if (/['\\\x00;]/.test(String(password || ''))) throw new Error('Invalid password characters');
  const sql = renderTemplate('postgres/grants.sql.hbs', {
    create_statements: postgresCreateStatements(mode, databaseName, databaseUser, password),
    db_name: databaseName,
    db_user: databaseUser,
  });
  const directory = path.join(root, 'generated', 'postgres');
  fs.mkdirSync(directory, { recursive: true });
  const sqlPath = path.join(directory, `${databaseName}.sql`);
  fs.writeFileSync(sqlPath, sql, { mode: 0o600 });
  const socket = postgresSocket();
  if (!socket) return { sqlPath, executed: false, granted: false, reason: 'PostgreSQL socket unavailable' };
  try {
    await command('psql', ['-h', path.dirname(socket), '-p', '5432', '-U', 'postgres', '-d', 'postgres'], { input: sql });
  } catch (error) {
    throw new Error(error.message || 'PostgreSQL provisioning failed');
  }
  return { sqlPath, executed: true, granted: true };
}

async function dumpPostgres(database, destinationDir, command) {
  fs.mkdirSync(destinationDir, { recursive: true });
  const name = postgresIdent(database.db_name);
  const archivePath = path.join(destinationDir, `${name}.sql.gz`);
  const socket = postgresSocket();
  if (!socket) throw new Error('PostgreSQL socket unavailable');
  let dumped;
  try {
    dumped = await command('pg_dump', ['-h', path.dirname(socket), '-U', 'postgres', '-d', name, '--no-owner']);
  } catch (error) {
    throw new Error(error.message || 'pg_dump failed');
  }
  if (!(dumped.stdout || '').trim()) throw new Error('Empty database dump');
  fs.writeFileSync(archivePath, zlib.gzipSync(`${dumped.stdout}\n`));
  return { path: archivePath, size: fs.statSync(archivePath).size };
}

module.exports = { postgresIdent, postgresSocket, provisionPostgres, dumpPostgres };
