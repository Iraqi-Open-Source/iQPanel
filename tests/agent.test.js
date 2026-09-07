const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-agent-'));
process.env.PANEL_DATA_ROOT = dataRoot;
process.env.PANEL_SITES_ROOT = path.join(dataRoot, 'sites');
process.env.PANEL_SECRET_KEY = 'agent-test-secret';

const agent = require('../ops');

test('writes MySQL grant SQL for a new database and user', async () => {
  const result = await agent.provisionDatabase({
    db_name: 'demo_app',
    db_user: 'demo_app_user',
    password: 's3cret-pass',
    mode: 'create',
  });
  const sql = fs.readFileSync(result.sqlPath, 'utf8');
  assert.match(sql, /CREATE DATABASE IF NOT EXISTS `demo_app`/);
  assert.match(sql, /CREATE USER IF NOT EXISTS 'demo_app_user'@'localhost'/);
  assert.match(sql, /GRANT ALL PRIVILEGES ON `demo_app`\.\*/);
  assert.equal(result.executed, false);
  assert.equal(result.granted, false);
});

test('dumpDatabase fails when MySQL socket is unavailable', async () => {
  const destination = path.join(dataRoot, 'dumps');
  await assert.rejects(() => agent.dumpDatabase({ db_name: 'demo_app' }, destination), /MySQL socket unavailable/);
});

test('discovers and tails per-site application logs', async () => {
  agent.createSite('log-demo');
  const laravelLog = path.join(dataRoot, 'sites', 'log-demo', 'app', 'storage', 'logs', 'laravel.log');
  fs.mkdirSync(path.dirname(laravelLog), { recursive: true });
  fs.writeFileSync(laravelLog, 'first line\nsecond line\n');
  const sources = agent.discoverLogs('log-demo');
  assert.equal(sources.some((source) => source.name === 'laravel' && source.exists), true);
  const text = await agent.readLog('log-demo', 'laravel', 50);
  assert.match(text, /second line/);
});

test('prunes local backups according to retention policy', async () => {
  const site = { slug: 'retain-me', type: 'php', port: 8010, domain: null, runtime_version: '8.3' };
  agent.createSite(site.slug);
  fs.writeFileSync(path.join(dataRoot, 'sites', site.slug, 'app', 'index.php'), '<?php\n');
  await agent.createBackup(site, [], { keepCount: 2, keepDays: 30 });
  await agent.createBackup(site, [], { keepCount: 2, keepDays: 30 });
  await agent.createBackup(site, [], { keepCount: 2, keepDays: 30 });
  const stamps = fs.readdirSync(path.join(dataRoot, 'backups', site.slug));
  assert.equal(stamps.length, 2);
});

test('renders Nginx and PHP-FPM configs from templates', () => {
  const site = { slug: 'templated', type: 'php', port: 8088, domain: 'app.test', runtime_version: '8.3' };
  const nginx = fs.readFileSync(agent.writeNginxConfig(site), 'utf8');
  const pool = fs.readFileSync(agent.writePhpPool(site).filePath, 'utf8');
  assert.match(nginx, /listen 80;/);
  assert.match(nginx, /server_name app\.test;/);
  assert.match(nginx, /fastcgi_pass unix:\/run\/php\/templated\.sock;/);
  assert.match(pool, /\[templated\]/);
  assert.match(pool, /user = iqpanel-templated/);
  assert.match(pool, /memory_limit/);
});

test('apply mode stays off in generated-only environments', async () => {
  const site = { slug: 'apply-off', type: 'node', port: 8020, app_port: 9100, domain: null, runtime_version: null };
  agent.createSite(site.slug);
  const result = await agent.applyNginxConfig(site);
  assert.equal(result.applied, false);
  assert.ok(fs.existsSync(result.path));
});

test('crontab rendering preserves foreign entries', () => {
  const existing = '0 0 * * * /usr/bin/true\n# BEGIN iqpanel\nold\n# END iqpanel\n';
  const merged = agent.renderCrontab(existing, [{ id: '1', slug: 'demo', schedule: '* * * * *', command: 'echo hi', enabled: true }]);
  assert.match(merged, /\/usr\/bin\/true/);
  assert.match(merged, /echo hi/);
  assert.match(merged, /# BEGIN iqpanel/);
});
