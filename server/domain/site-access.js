/**
 * Domain XOR port, PHP version validation, and live Nginx/PHP-FPM re-apply.
 */
import { query, get, run } from '../data/db.js';
import { invoke } from '../agent-client.js';
import {
  buildNginxVhost, buildPhpFpmPool, buildLaravelVhost,
  buildQueueWorkerUnit, buildHorizonUnit,
} from './provisioning.js';
import { allocatePort, assertPortFree } from './ports.js';
import { siteUserName } from './sites.js';

export const ALLOWED_PHP_VERSIONS = ['7.4', '8.0', '8.1', '8.2', '8.3', '8.4', '8.5'];

export function httpError(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export function parsePort(port) {
  if (port === '' || port === undefined || port === null || port === 0 || port === '0') return null;
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw httpError('Invalid port');
  return n;
}

function trimDomain(domain) {
  if (domain == null || domain === '') return null;
  const host = String(domain).trim();
  return host || null;
}

/**
 * Domain XOR custom listen port.
 * Empty port in port mode keeps the previous port when one exists, otherwise needs auto-allocation.
 */
export function normalizeAccess({ domain, port }, { previous } = {}) {
  const host = trimDomain(domain);
  const assignedPort = parsePort(port);

  if (host && assignedPort != null) {
    throw httpError('Site cannot have both a domain and a listen port');
  }
  if (host) return { domain: host, port: null, needsAutoPort: false };
  if (assignedPort != null) return { domain: null, port: assignedPort, needsAutoPort: false };

  const prevPort = previous?.port != null ? Number(previous.port) : null;
  const prevDomain = trimDomain(previous?.domain);
  if (prevPort && !prevDomain) {
    return { domain: null, port: prevPort, needsAutoPort: false };
  }
  return { domain: null, port: null, needsAutoPort: true };
}

export function shouldResetSsl(prev, next) {
  const prevDomain = trimDomain(prev?.domain);
  if (!prevDomain) return false;
  return prevDomain !== trimDomain(next?.domain);
}

export function assertAllowedPhpVersion(version) {
  if (!ALLOWED_PHP_VERSIONS.includes(version)) {
    throw httpError(`Unsupported PHP version: ${version}`);
  }
}

export async function assertPhpInstalled(version, { invokeFn = invoke } = {}) {
  assertAllowedPhpVersion(version);
  let installed;
  try {
    installed = await invokeFn('php.installed_versions');
  } catch (e) {
    throw httpError(`Could not list PHP versions: ${e.message}`, 503);
  }
  if (!installed?.[version]) {
    throw httpError(`PHP ${version} is not installed`);
  }
}

export async function resolveSiteAccess(body, { previous = null, excludeSiteId = null, invokeFn = invoke } = {}) {
  const incomingDomain = body.domain !== undefined ? body.domain : previous?.domain;
  const incomingPort = body.port !== undefined ? body.port : previous?.port;
  const norm = normalizeAccess(
    { domain: incomingDomain, port: incomingPort },
    { previous },
  );

  let { domain, port, needsAutoPort } = norm;
  if (needsAutoPort) {
    port = await allocatePort({ invokeFn });
  } else if (port != null) {
    await assertPortFree(port, {
      excludeSiteId,
      allowPort: previous?.port != null ? Number(previous.port) : null,
      invokeFn,
    });
  }
  return { domain, port };
}

function isProtectedPort(port) {
  const n = Number(port);
  if (n === 80 || n === 443) return true;
  const panel = Number(process.env.PANEL_PORT);
  return Number.isInteger(panel) && panel > 0 && n === panel;
}

function nowIso() {
  return new Date().toISOString();
}

async function rewritePhpConsumers(site, phpVersion, { invokeFn = invoke } = {}) {
  const siteUser = site.run_as_user || siteUserName(site.slug);
  const units = query('SELECT * FROM systemd_units WHERE site_id = ?', [site.id]);
  for (const unit of units) {
    let cfg = {};
    try { cfg = JSON.parse(unit.config || '{}'); } catch { cfg = {}; }
    const content = unit.template === 'horizon'
      ? buildHorizonUnit({ slug: site.slug, phpVersion, siteUser })
      : buildQueueWorkerUnit({
        slug: site.slug, phpVersion, siteUser,
        queue: cfg.queue ?? 'default',
        tries: cfg.tries ?? 3,
        timeout: cfg.timeout ?? 90,
      });
    await invokeFn('svc.install_unit', { name: unit.unit_name, content });
    try { await invokeFn('svc.restart', { unit: unit.unit_name }); } catch (e) {
      console.error('[site-access] unit restart failed', e?.message ?? e);
    }
  }

  const jobs = query(
    'SELECT * FROM cron_jobs WHERE site_id = ? AND command LIKE ?',
    [site.id, '%artisan schedule:run%'],
  );
  for (const job of jobs) {
    const cmd = `cd /var/www/sites/${site.slug}/app && php${phpVersion} artisan schedule:run >> /dev/null 2>&1`;
    run('UPDATE cron_jobs SET command = ? WHERE id = ?', [cmd, job.id]);
  }
  if (jobs.length) {
    try { await flushCrontab(invokeFn); } catch (e) {
      console.error('[site-access] crontab flush failed', e?.message ?? e);
    }
  }
}

async function flushCrontab(invokeFn) {
  const jobs = query('SELECT * FROM cron_jobs WHERE enabled = 1 ORDER BY created_at');
  const byUser = {};
  for (const job of jobs) {
    const u = job.run_as_user ?? 'root';
    byUser[u] = byUser[u] ?? [];
    byUser[u].push(`${job.schedule} ${job.command} # iqpanel:${job.id}`);
  }
  for (const [user, lines] of Object.entries(byUser)) {
    await invokeFn('cron.write', { user, lines });
  }
}

/**
 * Rewrite vhost, PHP-FPM pool, and firewall to match `next`.
 * `site` is the previous row (old php_version / domain / port).
 */
export async function applySiteAccess(site, next, { invokeFn = invoke } = {}) {
  const slug = site.slug;
  const type = site.type;
  const webserver = next.webserver ?? site.webserver ?? 'nginx';
  const phpVersion = next.php_version ?? site.php_version;
  const domain = next.domain ?? null;
  const port = next.port ?? null;
  const siteUser = site.run_as_user || siteUserName(slug);
  const directory = site.directory || `/var/www/sites/${slug}`;
  const oldPhp = site.php_version;
  const oldPort = site.port != null ? Number(site.port) : null;
  const oldDomain = site.domain || null;

  if (webserver === 'nginx') {
    const vhostContent = type === 'laravel'
      ? buildLaravelVhost({ slug, domain, port, phpVersion, siteUser })
      : buildNginxVhost({ slug, type, domain, port, phpVersion, siteUser });

    await invokeFn('nginx.write_vhost', { slug, content: vhostContent });

    const newPortOnly = Boolean(port) && !domain;
    const oldPortOnly = Boolean(oldPort) && !oldDomain;

    if (oldPortOnly && (!newPortOnly || Number(oldPort) !== Number(port)) && !isProtectedPort(oldPort)) {
      try { await invokeFn('fw.delete', { port: oldPort, proto: 'tcp' }); } catch (e) {
        console.error('[site-access] ufw delete failed', e?.message ?? e);
      }
    }
    if (newPortOnly && !isProtectedPort(Number(port))) {
      try { await invokeFn('fw.allow', { port, proto: 'tcp' }); } catch (e) {
        console.error('[site-access] ufw allow failed', e?.message ?? e);
      }
    }

    if (type === 'laravel' || type === 'php') {
      if (oldPhp && oldPhp !== phpVersion) {
        try { await invokeFn('php.remove_pool', { slug, version: oldPhp }); } catch (e) {
          console.error('[site-access] remove old pool failed', e?.message ?? e);
        }
      }
      const poolContent = buildPhpFpmPool({ slug, phpVersion, siteUser, directory });
      await invokeFn('php.write_pool', { slug, version: phpVersion, content: poolContent });
    }
  }

  if (oldPhp && phpVersion && oldPhp !== phpVersion) {
    await rewritePhpConsumers(site, phpVersion, { invokeFn });
  }
}

/**
 * Persist access fields, re-apply stack, roll back those columns on agent failure.
 */
export async function persistAndApplySiteAccess(site, next, { invokeFn = invoke } = {}) {
  const snapshot = {
    domain: site.domain,
    port: site.port,
    php_version: site.php_version,
    ssl_status: site.ssl_status,
  };
  const sslStatus = shouldResetSsl(site, next) ? 'none' : (site.ssl_status ?? 'none');
  const phpVersion = next.php_version ?? site.php_version;
  const domain = next.domain ?? null;
  const port = next.port ?? null;
  const extras = [];
  const extraVals = [];
  for (const k of ['name', 'webserver', 'deploy_branch', 'status']) {
    if (next[k] !== undefined) {
      extras.push(`${k} = ?`);
      extraVals.push(next[k]);
    }
  }

  run(
    `UPDATE sites SET domain = ?, port = ?, php_version = ?, ssl_status = ?${extras.length ? `, ${extras.join(', ')}` : ''}, updated_at = ? WHERE id = ?`,
    [domain, port, phpVersion, sslStatus, ...extraVals, nowIso(), site.id],
  );

  try {
    await applySiteAccess(site, { ...next, domain, port, php_version: phpVersion, ssl_status: sslStatus }, { invokeFn });
    return get('SELECT * FROM sites WHERE id = ?', [site.id]);
  } catch (e) {
    run(
      'UPDATE sites SET domain = ?, port = ?, php_version = ?, ssl_status = ?, updated_at = ? WHERE id = ?',
      [snapshot.domain, snapshot.port, snapshot.php_version, snapshot.ssl_status, nowIso(), site.id],
    );
    try {
      await applySiteAccess(
        { ...site, domain, port, php_version: phpVersion },
        { ...site, domain: snapshot.domain, port: snapshot.port, php_version: snapshot.php_version },
        { invokeFn },
      );
    } catch (restoreErr) {
      console.error('[site-access] restore after failure failed', restoreErr?.message ?? restoreErr);
    }
    throw e;
  }
}
