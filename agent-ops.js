const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const agent = require('./agent');
const { renderTemplate } = require('./template');
const paths = require('./paths');
const { root } = require('./db');

const CRON_BEGIN = '# BEGIN iqpanel';
const CRON_END = '# END iqpanel';
function mysqlIdent(value) {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(String(value || ""))) throw new Error("Invalid MySQL identifier");
  return String(value);
}

function mysqlSocket() {
  return ["/var/run/mysqld/mysqld.sock", "/run/mysqld/mysqld.sock", "/tmp/mysql.sock"].find((candidate) => fs.existsSync(candidate)) || null;
}

function createStatements(mode, databaseName, databaseUser) {
  if (mode === "attach") return "";
  return `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nCREATE USER IF NOT EXISTS '${databaseUser}'@'localhost';\n`;
}

async function provisionDatabase({ db_name, db_user, password, mode = "create" }) {
  const databaseName = mysqlIdent(db_name);
  const databaseUser = mysqlIdent(db_user);
  if (/['\\\x00;]/.test(String(password || ""))) throw new Error("Invalid password characters");
  const escaped = String(password).replaceAll('\'', "''");
  const sql = renderTemplate("mysql/grants.sql.hbs", {
    create_statements: createStatements(mode, databaseName, databaseUser),
    db_name: databaseName,
    db_user: databaseUser,
  });
  const directory = path.join(root, "generated", "mysql");
  fs.mkdirSync(directory, { recursive: true });
  const sqlPath = path.join(directory, `${databaseName}.sql`);
  fs.writeFileSync(sqlPath, sql, { mode: 0o600 });
  const executable = mode === "attach"
    ? sql
    : `CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nCREATE USER IF NOT EXISTS '${databaseUser}'@'localhost' IDENTIFIED BY '${escaped}';\n${sql}`;
  const socket = mysqlSocket();
  if (!socket) {
    return { sqlPath, executed: false, granted: false };
  }
  try {
    await agent.command("mysql", ["--protocol=socket", `--socket=${socket}`, "-uroot"], { input: executable });
  } catch (error) {
    throw new Error(error.message || "MySQL provisioning failed");
  }
  return { sqlPath, executed: true, granted: true };
}

async function dumpDatabase(database, destinationDir, password) {
  fs.mkdirSync(destinationDir, { recursive: true });
  const name = mysqlIdent(database.db_name);
  const archivePath = path.join(destinationDir, `${name}.sql.gz`);
  const socket = mysqlSocket();
  if (!socket) throw new Error("MySQL socket unavailable");
  const args = ["--protocol=socket", `--socket=${socket}`, "-uroot", "--single-transaction", "--routines", name];
  if (password != null && String(password) !== "") {
    args.splice(3, 0, `--password=${String(password)}`);
  }
  let dumped;
  try {
    dumped = await agent.command("mysqldump", args);
  } catch (error) {
    throw new Error(error.message || "mysqldump failed");
  }
  const sql = (dumped.stdout || "").trim();
  if (!sql) throw new Error("Empty database dump");
  fs.writeFileSync(archivePath, zlib.gzipSync(`${dumped.stdout}\n`));
  return { path: archivePath, size: fs.statSync(archivePath).size };
}

function pruneBackups(slug, retention = { keepCount: 5, keepDays: 14 }) {
  const directory = path.join(root, "backups", slug);
  if (!fs.existsSync(directory)) return [];
  const keepCount = Number(retention.keepCount || 5);
  const keepDays = Number(retention.keepDays || 14);
  const cutoff = Date.now() - keepDays * 86400000;
  const entries = fs.readdirSync(directory)
    .map((entryName) => {
      const full = path.join(directory, entryName);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((left, right) => right.full.localeCompare(left.full));
  const removed = [];
  entries.forEach((entry, index) => {
    if (index >= keepCount || entry.mtime < cutoff) {
      fs.rmSync(entry.full, { recursive: true, force: true });
      removed.push(entry.full);
    }
  });
  return removed;
}

async function createBackup(site, databases = [], retention = {}) {
  const stamp = `${new Date().toISOString().replaceAll(":", "-")}-${Math.random().toString(16).slice(2, 8)}`;
  const directory = path.join(root, "backups", site.slug, stamp);
  fs.mkdirSync(directory, { recursive: true });
  const archivePath = path.join(directory, "files.tar.gz");
  await agent.command("tar", ["--exclude=node_modules", "--exclude=vendor", "-czf", archivePath, "-C", agent.sitePath(site.slug), "app"]);
  for (const database of databases || []) {
    try {
      await dumpDatabase(database, directory, database.password);
    } catch (error) {
      const errorPath = path.join(directory, `${database.db_name}.dump-error.txt`);
      fs.writeFileSync(errorPath, String(error?.stack || error?.message || error));
    }
  }
  pruneBackups(site.slug, {
    keepCount: retention.keepCount ?? site.backup_keep_count ?? 5,
    keepDays: retention.keepDays ?? site.backup_keep_days ?? 14,
  });
  return { path: archivePath, size: fs.existsSync(archivePath) ? fs.statSync(archivePath).size : 0 };
}

function logSources(slug) {
  return [
    { name: "nginx-access", path: `/var/log/nginx/${slug}-access.log` },
    { name: "nginx-error", path: `/var/log/nginx/${slug}-error.log` },
    { name: "php-fpm", path: path.join(root, "logs", slug, "php-fpm.log") },
    { name: "laravel", path: path.join(agent.sitePath(slug), "app", "storage", "logs", "laravel.log") },
    { name: "panel", path: path.join(root, "logs", slug, "panel.log") },
  ];
}

function discoverLogs(slug) {
  return logSources(slug).map((source) => ({ ...source, exists: fs.existsSync(source.path) }));
}

async function readLog(slug, name, lines = 200) {
  const source = logSources(slug).find((item) => item.name === name);
  if (!source) throw new Error("Unknown log source");
  if (!fs.existsSync(source.path)) return "";
  const handle = fs.openSync(source.path, "r");
  try {
    const size = fs.fstatSync(handle).size;
    const start = Math.max(0, size - 262144);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(handle, buffer, 0, buffer.length, start);
    return buffer.toString("utf8").split("\n").slice(-Math.max(1, Number(lines))).join("\n");
  } finally {
    fs.closeSync(handle);
  }
}

function validateCronCommand(commandText) {
  const text = String(commandText || "");
  if (/[\r\n]/.test(text)) throw new Error("Cron command cannot contain newlines");
  if (text.includes("%")) throw new Error("Cron command cannot contain %");
  return text;
}

function assertCronUser(user) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(String(user || ""))) throw new Error("Invalid cron user");
}

function stripManagedBlock(text) {
  const lines = String(text || "").split("\n");
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === CRON_BEGIN) {
      skipping = true;
      continue;
    }
    if (line.trim() === CRON_END) {
      skipping = false;
      continue;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join("\n").replace(/\n+$/, "");
}

function buildCronBlock(jobs) {
  const lines = [CRON_BEGIN];
  for (const job of jobs || []) {
    if (job.enabled === false || job.enabled === 0) continue;
    validateCronCommand(job.command);
    lines.push(`${String(job.schedule || "").trim()} ${validateCronCommand(job.command)}`);
  }
  lines.push(CRON_END);
  return lines.join("\n");
}

function renderCrontab(existing, jobs) {
  const base = stripManagedBlock(existing);
  const block = buildCronBlock(jobs);
  const parts = [base, block].filter((part) => part && part.trim());
  return parts.length ? `${parts.join("\n")}\n` : `${block}\n`;
}

async function writeCrontab(user, jobs) {
  assertCronUser(user);
  const directory = path.join(paths.generatedRoot(), "cron");
  fs.mkdirSync(directory, { recursive: true });
  let existing = "";
  if (paths.applySystem) {
    try {
      const listed = await agent.command("crontab", ["-u", user, "-l"]);
      existing = listed.stdout || "";
    } catch {
      existing = "";
    }
  }
  const merged = renderCrontab(existing, jobs);
  const filePath = path.join(directory, `${user}.cron`);
  fs.writeFileSync(filePath, merged, { mode: 0o600 });
  if (!paths.applySystem) return { user, jobs: (jobs || []).length, applied: false, path: filePath };
  await agent.command("crontab", ["-u", user, "-"], { input: merged });
  return { user, jobs: (jobs || []).length, applied: true, path: filePath };
}

function ping() {
  return { ok: true, ts: new Date().toISOString() };
}

async function serviceStatus() {
  async function unitState(unit) {
    try {
      const result = await agent.command("systemctl", ["show", "-p", "LoadState", "-p", "ActiveState", unit]);
      const parsed = Object.fromEntries(
        String(result.stdout || "")
          .split("\n")
          .map((line) => {
            const index = line.indexOf("=");
            return index === -1 ? null : [line.slice(0, index), line.slice(index + 1)];
          })
          .filter(Boolean),
      );
      if (!parsed.LoadState || parsed.LoadState === "not-found") return "not_installed";
      return parsed.ActiveState || "unknown";
    } catch {
      return "not_installed";
    }
  }
  return {
    nginx: await unitState("nginx.service"),
    php_fpm: await unitState(`php${paths.phpVersion}-fpm.service`),
    mysql: await unitState("mysql.service"),
  };
}

module.exports = {
  ...agent,
  CRON_BEGIN,
  CRON_END,
  ping,
  serviceStatus,
  provisionDatabase,
  dumpDatabase,
  createBackup,
  discoverLogs,
  readLog,
  writeCrontab,
  renderCrontab,
  buildCronBlock,
  validateCronCommand,
};
