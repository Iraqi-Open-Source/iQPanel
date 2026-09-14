/**
 * Domain XOR port, uniqueness excluding the current site, and PATCH rollback.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.PANEL_DATA_ROOT = mkdtempSync(join(tmpdir(), 'iqpanel-access-'));
process.env.PANEL_SECRET_KEY = 'test-secret-key-for-tests-only-32';
process.env.PANEL_PORT = '4173';

const { run, get } = await import('../server/data/db.js');
const {
  normalizeAccess, parsePort, shouldResetSsl, persistAndApplySiteAccess, applySiteAccess,
  ALLOWED_PHP_VERSIONS,
} = await import('../server/domain/site-access.js');
const { assertPortFree, dbUsedPorts } = await import('../server/domain/ports.js');

const silentInvoke = async (action) => {
  if (action === 'fw.listeners') return [];
  return {};
};

function insertSite({
  id = 'site-a',
  slug = 'site-a',
  domain = null,
  port = null,
  php_version = '8.3',
  type = 'laravel',
  ssl_status = 'none',
} = {}) {
  const now = new Date().toISOString();
  run(
    `INSERT INTO sites (id,name,slug,type,repo_url,domain,port,php_version,webserver,run_as_user,directory,status,ssl_status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, slug, slug, type, null, domain, port, php_version, 'nginx', `iqpanel-${slug}`, `/var/www/sites/${slug}`, 'online', ssl_status, now, now],
  );
  return get('SELECT * FROM sites WHERE id = ?', [id]);
}

describe('normalizeAccess', () => {
  test('domain mode clears port', () => {
    const n = normalizeAccess({ domain: 'app.example.com', port: null });
    assert.equal(n.domain, 'app.example.com');
    assert.equal(n.port, null);
    assert.equal(n.needsAutoPort, false);
  });

  test('rejects domain and port together', () => {
    assert.throws(
      () => normalizeAccess({ domain: 'app.example.com', port: 8080 }),
      /both a domain and a listen port/,
    );
  });

  test('explicit port is port-only', () => {
    const n = normalizeAccess({ domain: null, port: 8088 });
    assert.equal(n.domain, null);
    assert.equal(n.port, 8088);
    assert.equal(n.needsAutoPort, false);
  });

  test('empty port in port mode keeps previous port', () => {
    const n = normalizeAccess({ domain: null, port: null }, { previous: { domain: null, port: 8123 } });
    assert.equal(n.port, 8123);
    assert.equal(n.needsAutoPort, false);
  });

  test('empty access with no previous port needs auto allocation', () => {
    const n = normalizeAccess({ domain: '', port: '' });
    assert.equal(n.domain, null);
    assert.equal(n.port, null);
    assert.equal(n.needsAutoPort, true);
  });

  test('switching from domain to empty port needs auto allocation', () => {
    const n = normalizeAccess({ domain: null, port: null }, { previous: { domain: 'old.example.com', port: null } });
    assert.equal(n.needsAutoPort, true);
  });
});

describe('parsePort', () => {
  test('treats empty and zero as unset', () => {
    assert.equal(parsePort(null), null);
    assert.equal(parsePort(''), null);
    assert.equal(parsePort(0), null);
    assert.equal(parsePort('0'), null);
  });

  test('rejects out of range', () => {
    assert.throws(() => parsePort(70000), /Invalid port/);
    assert.throws(() => parsePort(-1), /Invalid port/);
    assert.throws(() => parsePort('abc'), /Invalid port/);
  });
});

describe('shouldResetSsl', () => {
  test('resets when domain changes or is removed', () => {
    assert.equal(shouldResetSsl({ domain: 'a.com' }, { domain: 'b.com' }), true);
    assert.equal(shouldResetSsl({ domain: 'a.com' }, { domain: null }), true);
    assert.equal(shouldResetSsl({ domain: 'a.com' }, { domain: 'a.com' }), false);
    assert.equal(shouldResetSsl({ domain: null }, { domain: 'a.com' }), false);
  });
});

describe('port uniqueness', () => {
  beforeEach(() => {
    run('DELETE FROM systemd_units');
    run('DELETE FROM cron_jobs');
    run('DELETE FROM sites');
  });

  test('dbUsedPorts excludes the current site', () => {
    insertSite({ id: 'a', slug: 'a', port: 8080 });
    insertSite({ id: 'b', slug: 'b', port: 8081 });
    assert.ok(dbUsedPorts().has(8080));
    assert.ok(dbUsedPorts({ excludeSiteId: 'a' }).has(8081));
    assert.equal(dbUsedPorts({ excludeSiteId: 'a' }).has(8080), false);
  });

  test('assertPortFree allows a site to keep its own port', async () => {
    insertSite({ id: 'a', slug: 'a', port: 8088 });
    const n = await assertPortFree(8088, { excludeSiteId: 'a', allowPort: 8088, invokeFn: silentInvoke });
    assert.equal(n, 8088);
  });

  test('assertPortFree rejects another site’s port', async () => {
    insertSite({ id: 'a', slug: 'a', port: 8088 });
    await assert.rejects(
      () => assertPortFree(8088, { excludeSiteId: 'b', invokeFn: silentInvoke }),
      /already assigned/,
    );
  });

  test('assertPortFree rejects 80, 443, and the panel port', async () => {
    await assert.rejects(() => assertPortFree(80, { invokeFn: silentInvoke }), /reserved/);
    await assert.rejects(() => assertPortFree(443, { invokeFn: silentInvoke }), /reserved/);
    await assert.rejects(() => assertPortFree(4173, { invokeFn: silentInvoke }), /used by the panel/);
  });
});

describe('applySiteAccess', () => {
  beforeEach(() => {
    run('DELETE FROM systemd_units');
    run('DELETE FROM cron_jobs');
    run('DELETE FROM sites');
  });

  test('moves the PHP-FPM pool and rewrites the vhost on version change', async () => {
    const site = insertSite({ php_version: '8.2', domain: 'app.example.com' });
    const calls = [];
    const invokeFn = async (action, args) => {
      calls.push({ action, args });
      if (action === 'fw.listeners') return [];
      return {};
    };
    await applySiteAccess(site, { php_version: '8.4', domain: 'app.example.com', port: null }, { invokeFn });
    assert.ok(calls.some((c) => c.action === 'nginx.write_vhost'));
    assert.ok(calls.some((c) => c.action === 'php.remove_pool' && c.args.version === '8.2'));
    assert.ok(calls.some((c) => c.action === 'php.write_pool' && c.args.version === '8.4'));
    const vhost = calls.find((c) => c.action === 'nginx.write_vhost');
    assert.match(vhost.args.content, /php8\.4-fpm-site-a\.sock/);
    assert.match(vhost.args.content, /listen 80/);
  });

  test('rewrites queue units and scheduler cron when PHP version changes', async () => {
    const site = insertSite({ php_version: '8.2', domain: 'app.example.com' });
    const now = new Date().toISOString();
    run(
      'INSERT INTO systemd_units (id,site_id,unit_name,template,config,status,created_at) VALUES (?,?,?,?,?,?,?)',
      ['u1', site.id, 'panel-site-a-queue.service', 'queue', JSON.stringify({ queue: 'default', tries: 3, timeout: 90 }), 'running', now],
    );
    run(
      'INSERT INTO cron_jobs (id,site_id,run_as_user,schedule,command,enabled,created_at) VALUES (?,?,?,?,?,1,?)',
      ['c1', site.id, site.run_as_user, '* * * * *', 'cd /var/www/sites/site-a/app && php8.2 artisan schedule:run >> /dev/null 2>&1', now],
    );
    const calls = [];
    const invokeFn = async (action, args) => {
      calls.push({ action, args });
      return {};
    };
    await applySiteAccess(site, { php_version: '8.4', domain: 'app.example.com', port: null }, { invokeFn });
    const unit = calls.find((c) => c.action === 'svc.install_unit');
    assert.ok(unit);
    assert.match(unit.args.content, /php8\.4 artisan queue:work/);
    assert.ok(calls.some((c) => c.action === 'cron.write'));
    const job = get('SELECT command FROM cron_jobs WHERE id = ?', ['c1']);
    assert.match(job.command, /php8\.4 artisan schedule:run/);
  });

  test('opens a new port and deletes the old one when switching ports', async () => {
    const site = insertSite({ domain: null, port: 8100 });
    const calls = [];
    const invokeFn = async (action, args) => {
      calls.push({ action, args });
      return {};
    };
    await applySiteAccess(site, { php_version: '8.3', domain: null, port: 8200 }, { invokeFn });
    assert.ok(calls.some((c) => c.action === 'fw.delete' && c.args.port === 8100));
    assert.ok(calls.some((c) => c.action === 'fw.allow' && c.args.port === 8200));
    const vhost = calls.find((c) => c.action === 'nginx.write_vhost');
    assert.match(vhost.args.content, /listen 8200/);
  });
});

describe('persistAndApplySiteAccess rollback', () => {
  beforeEach(() => {
    run('DELETE FROM systemd_units');
    run('DELETE FROM cron_jobs');
    run('DELETE FROM sites');
  });

  test('restores domain, port, php_version, and ssl_status if re-apply fails', async () => {
    const site = insertSite({
      domain: 'old.example.com',
      port: null,
      php_version: '8.3',
      ssl_status: 'active',
    });
    const invokeFn = async (action) => {
      if (action === 'nginx.write_vhost') throw new Error('nginx -t failed');
      return {};
    };
    await assert.rejects(
      () => persistAndApplySiteAccess(site, {
        domain: 'new.example.com',
        port: null,
        php_version: '8.4',
      }, { invokeFn }),
      /nginx -t failed/,
    );
    const row = get('SELECT * FROM sites WHERE id = ?', [site.id]);
    assert.equal(row.domain, 'old.example.com');
    assert.equal(row.port, null);
    assert.equal(row.php_version, '8.3');
    assert.equal(row.ssl_status, 'active');
  });

  test('clears ssl_status when domain changes successfully', async () => {
    const site = insertSite({
      domain: 'old.example.com',
      php_version: '8.3',
      ssl_status: 'active',
    });
    const invokeFn = async () => ({});
    const updated = await persistAndApplySiteAccess(site, {
      domain: 'new.example.com',
      port: null,
      php_version: '8.3',
    }, { invokeFn });
    assert.equal(updated.domain, 'new.example.com');
    assert.equal(updated.ssl_status, 'none');
    assert.equal(updated.php_version, '8.3');
  });
});

describe('PHP allowlist', () => {
  test('includes 7.4 through 8.5', () => {
    assert.deepEqual(ALLOWED_PHP_VERSIONS, ['7.4', '8.0', '8.1', '8.2', '8.3', '8.4', '8.5']);
  });
});
