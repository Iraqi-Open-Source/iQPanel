const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-integrations-'));
process.env.PANEL_DATA_ROOT = dataRoot;
process.env.PANEL_SITES_ROOT = path.join(dataRoot, 'sites');
process.env.PANEL_SECRET_KEY = 'integration-test-secret';
process.env.PANEL_APPLY_SYSTEM = '0';

const db = require('../db');
const secrets = require('../secrets');
const alerts = require('../alerts');
const integrations = require('../agent-integrations');
const agent = require('../agent');
const { writeSystemdTemplate } = require('../agent-systemd');
const { PACKAGE_ALLOWLIST } = require('../http-installer');

test('host integrations stay generated-only in local mode', async () => {
  const swap = await integrations.swap('enable', 512, async () => { throw new Error('must not execute'); });
  assert.equal(swap.applied, false);
  assert.equal(swap.size_mb, 512);
  const disk = await integrations.extendDisk('/dev/vg0/app', 'lvm', true, async () => { throw new Error('must not execute'); });
  assert.equal(disk.dry_run, true);
  await assert.rejects(() => integrations.extendDisk('/tmp/unsafe', 'lvm', true, async () => {}), /Invalid disk device/);
  const file = integrations.writeOpenLiteSpeedConfig({ slug: 'demo-site', domain: 'demo.example.com', port: 8010 });
  assert.ok(fs.existsSync(file));
});

test('authorized key management is idempotent and validates key input', () => {
  process.env.PANEL_AUTHORIZED_KEYS_PATH = path.join(dataRoot, 'ssh', 'authorized_keys');
  const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIE2testkey panel';
  const first = integrations.manageAuthorizedKey('add', key);
  const second = integrations.manageAuthorizedKey('add', key);
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(integrations.listAuthorizedKeys().keys.length, 1);
  assert.throws(() => integrations.manageAuthorizedKey('add', 'not-a-key'), /Unsupported SSH public key/);
});

test('alert delivery deduplicates each channel during the cooldown window', async () => {
  db.run(`INSERT INTO settings(key,value) VALUES ('discord_webhook',${db.sql(secrets.encrypt('https://discord.test/webhook'))}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  let calls = 0;
  const previousFetch = global.fetch;
  global.fetch = async () => { calls += 1; return { ok: true }; };
  try {
    const limits = { cpu: 80, memory: 95, disk: 95 };
    await alerts.dispatch({ cpu: 91, memory: 20, disk: 20 }, { limits, cooldownMinutes: 60 });
    await alerts.dispatch({ cpu: 92, memory: 20, disk: 20 }, { limits, cooldownMinutes: 60 });
  } finally {
    global.fetch = previousFetch;
  }
  assert.equal(calls, 1);
  assert.equal(db.rows("SELECT COUNT(*) AS count FROM alert_events WHERE channel='discord' AND status='sent'")[0].count, 1);
});

test('file uploads and WordPress restores remain confined and rollback on archive failure', async () => {
  const app = path.join(dataRoot, 'sites', 'demo-site', 'app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'index.php'), 'original');
  assert.throws(() => agent.writeSiteFile('demo-site', '../outside.txt', 'unsafe'), /Path escapes site root/);
  assert.throws(() => agent.mutateSiteFile('demo-site', 'rename', 'index.php', '../outside.php'), /Path escapes site root/);
  const backupRoot = path.join(dataRoot, 'backups', 'demo-site', 'wordpress');
  fs.mkdirSync(backupRoot, { recursive: true });
  const invalidBackup = path.join(backupRoot, 'invalid.tar.gz');
  fs.writeFileSync(invalidBackup, 'not an archive');
  await assert.rejects(() => agent.wordpressRestore('demo-site', invalidBackup));
  assert.equal(fs.readFileSync(path.join(app, 'index.php'), 'utf8'), 'original');
  await assert.rejects(() => agent.wordpress('demo-site', 'plugin_activate', ['../unsafe']), /Invalid plugin slug/);
});

test('service installer exposes only the package allowlist', () => {
  assert.equal(PACKAGE_ALLOWLIST.has('nginx'), true);
  assert.equal(PACKAGE_ALLOWLIST.has('bash -c id'), false);
});

test('all documented Python and Laravel systemd templates render', () => {
  const site = { slug: 'template-site', runtime_version: '8.3', app_port: 8123, run_as_user: 'iqpanel-template-site', entrypoint: 'worker.py', python_module: 'config.wsgi' };
  for (const template of ['horizon', 'gunicorn', 'celery', 'python-worker']) {
    const rendered = writeSystemdTemplate(site, template, agent.sitePath);
    assert.ok(fs.existsSync(rendered.filePath));
    const content = fs.readFileSync(rendered.filePath, 'utf8');
    assert.match(content, /User=iqpanel-template-site/);
    assert.match(content, /8123|php8\.3|config\.wsgi|worker\.py/);
  }
});
