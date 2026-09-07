const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iqpanel-phase2-'));
process.env.PANEL_DATA_ROOT = dataRoot;
process.env.PANEL_SITES_ROOT = path.join(dataRoot, 'sites');
process.env.PANEL_SECRET_KEY = 'phase2-agent-secret';
process.env.PANEL_PHP_VERSIONS = '8.2,8.3,8.4';
process.env.PANEL_NODE_VERSIONS = '20,22';

const agent = require('../ops');
const { splitTelegramChunks, ftpUploadUrl, telegramCaption } = require('../backup-remote');
const runtimes = require('../runtimes');
const terminal = require('../terminal');

test('renders Apache PHP, proxy, and static vhosts from templates', () => {
  const phpSite = { slug: 'apache-php', type: 'php', port: 8081, domain: 'php.test', webserver: 'apache', runtime_version: '8.3' };
  const nodeSite = { slug: 'apache-node', type: 'node', port: 8082, app_port: 9101, domain: 'node.test', webserver: 'apache' };
  const staticSite = { slug: 'apache-static', type: 'static', port: 8083, domain: 'static.test', webserver: 'apache' };
  agent.createSite(phpSite.slug);
  agent.createSite(nodeSite.slug);
  agent.createSite(staticSite.slug);
  const php = fs.readFileSync(agent.writeApacheConfig(phpSite), 'utf8');
  const proxy = fs.readFileSync(agent.writeApacheConfig(nodeSite), 'utf8');
  const stat = fs.readFileSync(agent.writeApacheConfig(staticSite), 'utf8');
  assert.match(php, /<VirtualHost \*:80>/);
  assert.match(php, /ServerName php\.test/);
  assert.match(php, /SuexecUserGroup iqpanel-apache-php iqpanel-apache-php/);
  assert.match(php, /AssignUserID iqpanel-apache-php iqpanel-apache-php/);
  assert.match(proxy, /ProxyPass \/ http:\/\/127\.0\.0\.1:9101\//);
  assert.match(stat, /FallbackResource \/index.html/);
});

test('writes PostgreSQL grant SQL and reports ungranted without a live socket', async () => {
  const result = await agent.provisionDatabase({
    engine: 'postgres',
    db_name: 'demo_pg',
    db_user: 'demo_pg_user',
    password: 's3cret-pass',
    mode: 'create',
  });
  const sql = fs.readFileSync(result.sqlPath, 'utf8');
  assert.match(sql, /CREATE DATABASE demo_pg/);
  assert.match(sql, /CREATE USER demo_pg_user/);
  assert.match(sql, /GRANT ALL PRIVILEGES ON DATABASE demo_pg TO demo_pg_user/);
  assert.equal(result.executed, false);
  assert.equal(result.granted, false);
});

test('dumpDatabase fails when PostgreSQL socket is unavailable', async () => {
  const destination = path.join(dataRoot, 'pg-dumps');
  await assert.rejects(
    () => agent.dumpDatabase({ engine: 'postgres', db_name: 'demo_pg' }, destination),
    /PostgreSQL socket unavailable/,
  );
});

test('lists configured PHP and Node runtimes', () => {
  const listed = runtimes.list();
  assert.deepEqual(listed.php, ['8.2', '8.3', '8.4']);
  assert.deepEqual(listed.node, ['20', '22']);
  assert.ok(listed.python.length >= 1);
});

test('renders FastAPI, Node, and ASP.NET systemd templates', () => {
  const site = { slug: 'multi-svc', type: 'node', port: 8090, app_port: 9200, runtime_version: '22', node_version: '22' };
  agent.createSite(site.slug);
  const fastapi = fs.readFileSync(agent.writeSystemdTemplate(site, 'fastapi').filePath, 'utf8');
  const node = fs.readFileSync(agent.writeSystemdTemplate(site, 'node').filePath, 'utf8');
  const aspnet = fs.readFileSync(agent.writeSystemdTemplate(site, 'aspnet').filePath, 'utf8');
  assert.match(fastapi, /User=iqpanel-multi-svc/);
  assert.match(node, /User=iqpanel-multi-svc/);
  assert.match(node, /node_version|PORT=9200|dist\/main\.js/);
  assert.match(aspnet, /dotnet/);
});

test('docker status is honest when the engine socket is missing', async () => {
  const status = await agent.dockerStatus();
  assert.equal(status.available, false);
  assert.match(String(status.reason || ''), /docker|socket|unavailable/i);
});

test('splits Telegram uploads into 50MB chunks with a part caption', () => {
  const file = path.join(dataRoot, 'big.bin');
  fs.writeFileSync(file, Buffer.alloc(120));
  const chunks = splitTelegramChunks(file, 50);
  assert.equal(chunks.length, 3);
  assert.equal(telegramCaption('site-backup', 2, 3), 'site-backup part 2/3');
});

test('builds an FTP destination URL without embedding the password in logs', () => {
  const url = ftpUploadUrl({ host: 'ftp.example.com', user: 'panel', password: 'secret', remotePath: '/backups/files.tar.gz' });
  assert.match(url, /^ftp:\/\/panel:\*\*\*@ftp\.example\.com\/backups\/files\.tar\.gz$/);
});

test('certbot and UFW stay generated-only when apply mode is off', async () => {
  const site = { slug: 'ssl-demo', type: 'php', port: 8044, domain: 'ssl.example.test', webserver: 'nginx' };
  agent.createSite(site.slug);
  const ssl = await agent.requestCertificate(site);
  const ufw = await agent.openSitePort(site.port);
  assert.equal(ssl.applied, false);
  assert.equal(ufw.applied, false);
  assert.ok(fs.existsSync(ssl.path));
  assert.match(fs.readFileSync(ssl.path, 'utf8'), /certbot/);
  assert.match(fs.readFileSync(ufw.path, 'utf8'), /ufw allow 8044\/tcp/);
});

test('terminal sessions stream command output and record close', async () => {
  const session = terminal.createSession({ command: process.execPath, args: ['-e', 'process.stdin.on("data", (d) => process.stdout.write(d))'] });
  assert.ok(session.id);
  terminal.write(session.id, 'hello-term\n');
  const output = await waitForOutput(session.id, /hello-term/);
  assert.match(output, /hello-term/);
  terminal.close(session.id);
  assert.equal(terminal.get(session.id), undefined);
});

async function waitForOutput(id, pattern) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const text = terminal.read(id);
    if (pattern.test(text)) return text;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`terminal ${id} did not emit expected output`);
}
