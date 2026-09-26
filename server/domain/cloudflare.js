/**
 * Cloudflare API v4 client. The API token is stored encrypted in settings.
 */
import { randomBytes } from 'node:crypto';
import { get, query, run } from '../data/db.js';
import { decryptField } from './secrets.js';

const API = 'https://api.cloudflare.com/client/v4';
const PROXIED_TYPES = new Set(['A', 'AAAA', 'CNAME']);
export const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX'];

export class CloudflareError extends Error {
  constructor(message, status = 502, errors = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

function uuid() {
  return randomBytes(16).toString('hex');
}

export function settingValue(key) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? '';
}

export function tokenConfigured() {
  return Boolean(settingValue('cloudflare_api_token'));
}

export function loadToken() {
  const stored = settingValue('cloudflare_api_token');
  if (!stored) {
    throw new CloudflareError('Cloudflare is not connected. Add an API token in Settings.', 400);
  }
  let token = '';
  try {
    token = decryptField(stored);
  } catch {
    throw new CloudflareError('Stored Cloudflare token cannot be decrypted. Save the token again.', 500);
  }
  if (!token) {
    throw new CloudflareError('Cloudflare is not connected. Add an API token in Settings.', 400);
  }
  return token;
}

export function isIpAddress(value) {
  const v = String(value ?? '').trim();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(v)) {
    return v.split('.').every((part) => {
      const n = Number(part);
      return n >= 0 && n <= 255 && String(n) === part;
    });
  }
  if (!v.includes(':') || !/^[0-9a-fA-F:]+$/.test(v)) return false;
  const groups = v.split('::');
  return groups.length <= 2 && v.length >= 2 && v.length <= 45;
}

export function autoDnsEnabled(explicit) {
  if (explicit === true || explicit === 1 || explicit === '1' || explicit === 'true') return true;
  if (explicit === false || explicit === 0 || explicit === '0' || explicit === 'false') return false;
  return settingValue('cloudflare_auto_dns') === '1';
}

export function matchZone(domain, zones) {
  const host = String(domain ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  let best = null;
  for (const zone of zones ?? []) {
    const name = String(zone?.name ?? '').trim().toLowerCase().replace(/\.$/, '');
    if (!name) continue;
    if (host === name || host.endsWith(`.${name}`)) {
      if (!best || name.length > best.name.length) best = { ...zone, name };
    }
  }
  return best;
}

export function recordName(prefix, zoneName) {
  const zone = String(zoneName ?? '').trim().replace(/\.$/, '').toLowerCase();
  const label = String(prefix ?? '').trim().replace(/\.$/, '').toLowerCase();
  if (!zone) throw new CloudflareError('Zone name required', 400);
  if (!label || label === '@' || label === zone) return zone;
  if (label.endsWith(`.${zone}`)) return label;
  return `${label}.${zone}`;
}

function normalizeRecord(record) {
  return {
    id: record.id,
    type: record.type,
    name: String(record.name ?? '').replace(/\.$/, ''),
    content: record.content,
    proxied: Boolean(record.proxied),
    ttl: record.ttl,
    priority: record.priority ?? null,
    comment: record.comment ?? '',
  };
}

function normalizeZone(zone) {
  return {
    id: zone.id,
    name: zone.name,
    status: zone.status,
    paused: Boolean(zone.paused),
    name_servers: zone.name_servers ?? [],
  };
}

async function resolveAccountId() {
  try {
    const zones = await cf('/zones', { query: { per_page: 1 } });
    const fromZone = zones.result?.[0]?.account?.id;
    if (fromZone) return fromZone;
  } catch { /* fall through to the accounts API */ }
  try {
    const accounts = await cf('/accounts', { query: { per_page: 1 } });
    return accounts.result?.[0]?.id ?? '';
  } catch {
    return '';
  }
}

async function cf(path, { method = 'GET', body, token, query: params } = {}) {
  const auth = token || loadToken();
  const url = new URL(API + path);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${auth}`,
        'Content-Type': 'application/json',
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new CloudflareError(`Cloudflare request failed: ${e.message ?? e}`, 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const msg = (data.errors ?? []).map((err) => err.message).filter(Boolean).join('; ')
      || res.statusText
      || 'Cloudflare request failed';
    const status = res.status >= 400 && res.status < 500 ? res.status : 502;
    throw new CloudflareError(msg, status, data.errors ?? []);
  }
  return data;
}

export async function verifyToken(token) {
  const data = await cf('/user/tokens/verify', { token: token || loadToken() });
  return data.result ?? {};
}

export async function listZones() {
  const zones = [];
  let page = 1;
  while (page <= 20) {
    const data = await cf('/zones', { query: { page, per_page: 50 } });
    zones.push(...(data.result ?? []).map(normalizeZone));
    const pages = data.result_info?.total_pages ?? 1;
    if (page >= pages) break;
    page += 1;
  }
  return zones;
}

export async function getZone(zoneId) {
  const data = await cf(`/zones/${zoneId}`);
  return normalizeZone(data.result);
}

export async function addZone(name) {
  const accountId = await resolveAccountId();
  if (!accountId) {
    throw new CloudflareError('This token cannot see a Cloudflare account. Include Account Read permission to add domains.', 400);
  }
  const data = await cf('/zones', {
    method: 'POST',
    body: { name, account: { id: accountId }, type: 'full' },
  });
  return normalizeZone(data.result);
}

export async function listDnsRecords(zoneId, { type, name } = {}) {
  const records = [];
  let page = 1;
  while (page <= 20) {
    const data = await cf(`/zones/${zoneId}/dns_records`, {
      query: { page, per_page: 100, type: type || undefined, name: name || undefined },
    });
    records.push(...(data.result ?? []).map(normalizeRecord));
    const pages = data.result_info?.total_pages ?? 1;
    if (page >= pages) break;
    page += 1;
  }
  return records;
}

function recordBody({ type, name, content, proxied, ttl, priority, comment }) {
  const recordType = String(type || 'A').toUpperCase();
  if (!DNS_RECORD_TYPES.includes(recordType)) {
    throw new CloudflareError(`Unsupported record type: ${recordType}`, 400);
  }
  if (!name || !String(content ?? '').trim()) {
    throw new CloudflareError('Record name and content are required', 400);
  }
  const body = {
    type: recordType,
    name,
    content: String(content).trim(),
    ttl: Number(ttl) > 0 ? Number(ttl) : 1,
  };
  if (PROXIED_TYPES.has(recordType) && proxied != null) body.proxied = Boolean(proxied);
  if (recordType === 'MX') body.priority = Number(priority) > 0 ? Number(priority) : 10;
  if (comment) body.comment = String(comment).slice(0, 100);
  return body;
}

export async function createDnsRecord(zoneId, input) {
  const data = await cf(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: recordBody({ ...input, proxied: input.proxied ?? true }),
  });
  return normalizeRecord(data.result);
}

export async function updateDnsRecord(zoneId, recordId, input) {
  const body = {};
  if (input.type != null) body.type = String(input.type).toUpperCase();
  if (input.name != null) body.name = input.name;
  if (input.content != null) body.content = String(input.content).trim();
  if (input.ttl != null) body.ttl = Number(input.ttl) > 0 ? Number(input.ttl) : 1;
  if (input.proxied != null) body.proxied = Boolean(input.proxied);
  if (input.priority != null) body.priority = Number(input.priority);
  const data = await cf(`/zones/${zoneId}/dns_records/${recordId}`, { method: 'PATCH', body });
  return normalizeRecord(data.result);
}

export async function deleteDnsRecord(zoneId, recordId) {
  await cf(`/zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' });
  return { ok: true };
}

export async function resolveServerIp({ refresh = false } = {}) {
  const stored = settingValue('server_public_ip').trim();
  if (stored && !refresh) return { ip: stored, source: 'settings' };
  const ip = await detectPublicIp();
  if (!stored || refresh) {
    run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ['server_public_ip', ip],
    );
  }
  return { ip, source: 'detected' };
}

async function detectPublicIp() {
  const sources = [
    async () => {
      const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`ipify ${res.status}`);
      return (await res.text()).trim();
    },
    async () => {
      const res = await fetch('https://ifconfig.me/ip', { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`ifconfig.me ${res.status}`);
      return (await res.text()).trim();
    },
  ];
  const errors = [];
  for (const source of sources) {
    try {
      const ip = await source();
      if (isIpAddress(ip)) return ip;
      errors.push('unexpected response');
    } catch (e) {
      errors.push(e.message ?? String(e));
    }
  }
  throw new CloudflareError(`Could not detect the server public IP (${errors.join('; ')}). Set it in Settings.`, 502);
}

export function saveDnsRecordRow({ siteId = null, zoneId, zoneName, record }) {
  const existing = get('SELECT id FROM cloudflare_dns_records WHERE record_id = ?', [record.id]);
  const proxied = record.proxied ? 1 : 0;
  if (existing) {
    run(
      `UPDATE cloudflare_dns_records
       SET site_id = COALESCE(?, site_id), zone_id = ?, zone_name = ?, record_type = ?, record_name = ?, record_content = ?, proxied = ?
       WHERE id = ?`,
      [siteId, zoneId, zoneName, record.type, record.name, record.content, proxied, existing.id],
    );
    return get('SELECT * FROM cloudflare_dns_records WHERE id = ?', [existing.id]);
  }
  const id = uuid();
  run(
    `INSERT INTO cloudflare_dns_records
      (id, site_id, zone_id, zone_name, record_id, record_type, record_name, record_content, proxied, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, siteId, zoneId, zoneName, record.id, record.type, record.name, record.content, proxied, new Date().toISOString()],
  );
  return get('SELECT * FROM cloudflare_dns_records WHERE id = ?', [id]);
}

export async function syncSiteDns(site, domain) {
  if (!domain) return { skipped: true, reason: 'no_domain' };
  if (!tokenConfigured()) return { skipped: true, reason: 'not_configured' };

  const zones = await listZones();
  const zone = matchZone(domain, zones);
  if (!zone) return { skipped: true, reason: 'no_zone' };

  const { ip } = await resolveServerIp();
  const existing = get(
    'SELECT * FROM cloudflare_dns_records WHERE site_id = ? AND record_type = ? ORDER BY created_at DESC',
    [site.id, 'A'],
  );

  let action = 'created';
  let record;
  if (existing?.zone_id === zone.id && existing.record_id) {
    try {
      record = await updateDnsRecord(zone.id, existing.record_id, {
        type: 'A',
        name: domain,
        content: ip,
        proxied: true,
        ttl: 1,
      });
      action = 'updated';
    } catch (e) {
      if (e.status !== 404 && !/not found/i.test(e.message ?? '')) throw e;
      run('DELETE FROM cloudflare_dns_records WHERE id = ?', [existing.id]);
    }
  } else if (existing) {
    try { await deleteDnsRecord(existing.zone_id, existing.record_id); } catch (e) {
      console.error('[cloudflare] remove previous record failed', e?.message ?? e);
    }
    run('DELETE FROM cloudflare_dns_records WHERE id = ?', [existing.id]);
  }

  if (!record) {
    try {
      record = await createDnsRecord(zone.id, {
        type: 'A', name: domain, content: ip, proxied: true, ttl: 1,
      });
    } catch (e) {
      if (!/already exists/i.test(e.message ?? '')) throw e;
      const found = await listDnsRecords(zone.id, { type: 'A', name: domain });
      record = found.find((item) => item.name.toLowerCase() === domain.toLowerCase());
      if (!record) throw e;
      action = 'adopted';
    }
  }

  const row = saveDnsRecordRow({ siteId: site.id, zoneId: zone.id, zoneName: zone.name, record });
  return { ok: true, action, zone: zone.name, record: row };
}

export async function removeSiteDns(siteId) {
  const rows = query('SELECT * FROM cloudflare_dns_records WHERE site_id = ?', [siteId]);
  const errors = [];
  for (const row of rows) {
    try {
      if (tokenConfigured()) await deleteDnsRecord(row.zone_id, row.record_id);
    } catch (e) {
      if (e.status !== 404 && !/not found/i.test(e.message ?? '')) {
        errors.push(`${row.record_name}: ${e.message}`);
        continue;
      }
    }
    run('DELETE FROM cloudflare_dns_records WHERE id = ?', [row.id]);
  }
  return { removed: rows.length, errors };
}
