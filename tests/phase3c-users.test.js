const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-phase3c-'));
process.env.PANEL_DATA_ROOT = dataRoot;
process.env.PANEL_SITES_ROOT = path.join(dataRoot, 'sites');
process.env.PANEL_SECRET_KEY = 'phase3c-secret';

const agent = require('../ops');
const { siteUserName, resolveRunAsUser, needsUserMigration } = require('../site-user');

const port = 4395;
const base = `http://127.0.0.1:${port}`;
const panel = spawn(process.execPath, ['app-http.js'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    PORT: String(port),
    PANEL_DATA_ROOT: dataRoot,
    PANEL_SITES_ROOT: path.join(dataRoot, 'sites'),
    PANEL_SECRET_KEY: 'phase3c-secret',
  },
  stdio: 'ignore',
});

test.after(() => panel.kill());

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/dashboard`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Phase 3C API did not start');
}

async function waitForJob(jobId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${base}/api/jobs/${jobId}`);
    const job = await response.json();
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`job ${jobId} did not finish`);
}

async function createSite(name, type = 'php') {
  const repoName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const response = await fetch(`${base}/api/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repo: `git@github.com:example/${repoName}.git`, name, type }),
  });
  if (response.status !== 201) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(`createSite ${name} failed: ${response.status} ${payload.error || ''}`);
  }
  return response.json();
}

test('site user names stay within the 32-character Unix limit', () => {
  assert.equal(siteUserName('blog'), 'iqpanel-blog');
  const long = siteUserName('this-is-a-very-long-site-slug-that-exceeds-unix-limits');
  assert.ok(long.length <= 32);
  assert.match(long, /^iqpanel-/);
});

test('createSite provisions an iqpanel user script and owns the site tree at 0750', () => {
  const created = agent.createSite('iso-alpha');
  assert.equal(created.run_as_user, 'iqpanel-iso-alpha');
  assert.equal(created.user_applied, false);
  const script = fs.readFileSync(created.user_script, 'utf8');
  assert.match(script, /useradd --system/);
  assert.match(script, /iqpanel-iso-alpha/);
  const mode = fs.statSync(created.directory).mode & 0o777;
  assert.equal(mode, 0o750);
});

test('PHP-FPM pool and systemd units run as the site user', () => {
  const site = { slug: 'iso-pool', type: 'php', port: 8088, domain: 'iso.test', runtime_version: '8.3' };
  agent.createSite(site.slug);
  const pool = fs.readFileSync(agent.writePhpPool(site).filePath, 'utf8');
  const unit = fs.readFileSync(agent.writeSystemdTemplate(site, 'laravel-queue').filePath, 'utf8');
  assert.match(pool, /user = iqpanel-iso-pool/);
  assert.match(pool, /group = iqpanel-iso-pool/);
  assert.match(unit, /User=iqpanel-iso-pool/);
});

test('file operations cannot traverse into another site root', () => {
  agent.createSite('iso-one');
  agent.createSite('iso-two');
  fs.writeFileSync(path.join(dataRoot, 'sites', 'iso-one', 'app', 'secret.txt'), 'one');
  assert.throws(() => agent.readSiteFile('iso-two', '../iso-one/app/secret.txt'), /escapes site root/);
  assert.throws(() => agent.listFiles('iso-one', '../../iso-two/app'), /escapes site root/);
});

test('removeSite writes a userdel script when the Unix user is unshared', async () => {
  agent.createSite('iso-gone');
  const result = await agent.removeSite('iso-gone', { run_as_user: 'iqpanel-iso-gone', remove_user: true });
  assert.equal(result.user_removed, false);
  const script = fs.readFileSync(path.join(dataRoot, 'generated', 'users', 'iso-gone.remove.sh'), 'utf8');
  assert.match(script, /userdel --force iqpanel-iso-gone/);
});

test('cron and terminal default to the site user unless escalated', () => {
  const site = { slug: 'iso-scope', run_as_user: 'iqpanel-iso-scope' };
  assert.equal(resolveRunAsUser({ site }), 'iqpanel-iso-scope');
  assert.throws(() => resolveRunAsUser({ site, requested: 'root' }), /Escalation required/);
  assert.equal(resolveRunAsUser({ site, requested: 'root', escalate: true }), 'root');
  assert.equal(needsUserMigration({ run_as_user: 'www-data' }), true);
  assert.equal(needsUserMigration({ run_as_user: 'iqpanel-iso-scope' }), false);
});

test('site create stores run_as_user and isolation holds across the file API', async () => {
  await waitForServer();
  const alpha = await createSite('Iso Alpha');
  const beta = await createSite('Iso Beta');
  assert.equal(alpha.run_as_user, 'iqpanel-iso-alpha');
  assert.equal(beta.run_as_user, 'iqpanel-iso-beta');
  await fetch(`${base}/api/sites/${alpha.slug}/files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'owned.txt', content: 'alpha-only' }),
  });
  const traversal = await fetch(`${base}/api/sites/${beta.slug}/files/content?path=../iso-alpha/app/owned.txt`);
  assert.equal(traversal.status, 400);
  const cron = await fetch(`${base}/api/cron`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ site_slug: alpha.slug, schedule: '* * * * *', command: 'true' }),
  });
  assert.equal(cron.status, 201);
  assert.equal((await cron.json()).run_as_user, 'iqpanel-iso-alpha');
  const denied = await fetch(`${base}/api/cron`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ site_slug: alpha.slug, schedule: '* * * * *', command: 'true', run_as_user: 'root' }),
  });
  assert.equal(denied.status, 400);
  const session = await (await fetch(`${base}/api/terminal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ site_slug: alpha.slug }),
  })).json();
  assert.equal(session.user, 'iqpanel-iso-alpha');
  assert.match(session.cwd, /iso-alpha/);
  await fetch(`${base}/api/terminal/${session.id}`, { method: 'DELETE' });
});

test('migration job reassigns www-data sites to iqpanel users', async () => {
  const site = await createSite('Legacy Owner');
  const db = require('../db');
  db.run(`UPDATE sites SET run_as_user='www-data' WHERE id=${db.sql(site.id)}`);
  const queued = await fetch(`${base}/api/system/migrate-site-users`, { method: 'POST' });
  assert.equal(queued.status, 202);
  const payload = await queued.json();
  const job = await waitForJob(payload.job_id);
  assert.equal(job.status, 'succeeded');
  const updated = await (await fetch(`${base}/api/sites/${site.slug}`)).json();
  assert.equal(updated.run_as_user, 'iqpanel-legacy-owner');
  const pool = fs.readFileSync(path.join(dataRoot, 'generated', 'php-fpm', `${site.slug}.conf`), 'utf8');
  assert.match(pool, /user = iqpanel-legacy-owner/);
});

test('deleting a site emits user removal when no other site shares the user', async () => {
  const site = await createSite('Disposable User');
  const deleted = await fetch(`${base}/api/sites/${site.slug}`, { method: 'DELETE' });
  assert.equal(deleted.status, 204);
  const script = fs.readFileSync(path.join(dataRoot, 'generated', 'users', `${site.slug}.remove.sh`), 'utf8');
  assert.match(script, /userdel --force iqpanel-disposable-user/);
});
