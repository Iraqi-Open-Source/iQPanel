import { get, query, run } from '../../data/db.js';
import { requireAuth } from '../middleware.js';
import { rbac } from '../rbac.js';
import { auditLog } from '../../domain/audit.js';
import {
  CloudflareError,
  DNS_RECORD_TYPES,
  addZone,
  createDnsRecord,
  deleteDnsRecord,
  getZone,
  listDnsRecords,
  listZones,
  recordName,
  removeSiteDns,
  resolveServerIp,
  saveDnsRecordRow,
  tokenConfigured,
  updateDnsRecord,
  verifyToken,
} from '../../domain/cloudflare.js';

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ZONE_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const RECORD_RE = /^(?:\*\.)?(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z]{2,}$/i;

function fail(res, error) {
  const status = error instanceof CloudflareError ? (error.status ?? 502) : (error.status ?? 500);
  res.status(status).json({ error: error.message ?? 'Cloudflare request failed' });
}

function assertId(value, label) {
  if (!ID_RE.test(String(value ?? ''))) {
    const error = new CloudflareError(`Invalid ${label}`, 400);
    throw error;
  }
}

export function registerCloudflare(app) {
  app.post('/api/cloudflare/verify', requireAuth, rbac('admin'), async (req, res) => {
    try {
      const supplied = String(req.body?.token ?? '').trim();
      const result = await verifyToken(supplied || undefined);
      res.json({ ok: true, status: result.status ?? 'active', id: result.id ?? null });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get('/api/cloudflare/server-ip', requireAuth, rbac('operator'), async (req, res) => {
    try {
      const found = await resolveServerIp({ refresh: req.query.refresh === '1' || req.query.refresh === 'true' });
      res.json(found);
    } catch (e) {
      fail(res, e);
    }
  });

  app.get('/api/cloudflare/zones', requireAuth, rbac('operator'), async (req, res) => {
    try {
      if (!tokenConfigured()) return res.json({ configured: false, zones: [] });
      const zones = await listZones();
      const counts = query('SELECT zone_id, COUNT(*) AS n FROM cloudflare_dns_records GROUP BY zone_id');
      const byZone = new Map(counts.map((row) => [row.zone_id, row.n]));
      res.json({
        configured: true,
        zones: zones.map((zone) => ({ ...zone, record_count: Number(byZone.get(zone.id) ?? 0) })),
      });
    } catch (e) {
      fail(res, e);
    }
  });

  app.post('/api/cloudflare/zones', requireAuth, rbac('admin'), async (req, res) => {
    try {
      const name = String(req.body?.name ?? '').trim().toLowerCase().replace(/\.$/, '');
      if (!ZONE_RE.test(name)) {
        return res.status(400).json({ error: 'Enter a domain like example.com' });
      }
      const zone = await addZone(name);
      auditLog(req, 'cloudflare.zone.create', name, { zone_id: zone.id });
      res.status(201).json(zone);
    } catch (e) {
      fail(res, e);
    }
  });

  app.get('/api/cloudflare/zones/:zoneId/dns', requireAuth, rbac('operator'), async (req, res) => {
    try {
      assertId(req.params.zoneId, 'zone id');
      const records = await listDnsRecords(req.params.zoneId, {
        type: req.query.type || undefined,
        name: req.query.name || undefined,
      });
      const managed = query(
        'SELECT record_id, site_id FROM cloudflare_dns_records WHERE zone_id = ?',
        [req.params.zoneId],
      );
      const byId = new Map(managed.map((row) => [row.record_id, row.site_id]));
      res.json(records.map((record) => ({
        ...record,
        managed: byId.has(record.id),
        site_id: byId.get(record.id) ?? null,
      })));
    } catch (e) {
      fail(res, e);
    }
  });

  app.post('/api/cloudflare/zones/:zoneId/dns', requireAuth, rbac('operator'), async (req, res) => {
    try {
      assertId(req.params.zoneId, 'zone id');
      const body = req.body ?? {};
      const type = String(body.type ?? 'A').toUpperCase();
      if (!DNS_RECORD_TYPES.includes(type)) {
        return res.status(400).json({ error: `Unsupported record type: ${type}` });
      }
      const zone = await getZone(req.params.zoneId);
      const name = recordName(body.name, zone.name);
      if (!RECORD_RE.test(name)) {
        return res.status(400).json({ error: 'Invalid record name' });
      }
      let siteId = null;
      if (body.site_id) {
        const site = get('SELECT id FROM sites WHERE id = ?', [body.site_id]);
        if (!site) return res.status(404).json({ error: 'Site not found' });
        siteId = site.id;
      } else if (body.site_slug) {
        const site = get('SELECT id FROM sites WHERE slug = ?', [body.site_slug]);
        if (!site) return res.status(404).json({ error: 'Site not found' });
        siteId = site.id;
      }
      const record = await createDnsRecord(zone.id, {
        type,
        name,
        content: body.content,
        proxied: body.proxied,
        ttl: body.ttl,
        priority: body.priority,
      });
      const row = saveDnsRecordRow({ siteId, zoneId: zone.id, zoneName: zone.name, record });
      auditLog(req, 'cloudflare.dns.create', name, { zone: zone.name, type });
      res.status(201).json({ ...record, managed: true, site_id: row.site_id });
    } catch (e) {
      fail(res, e);
    }
  });

  app.patch('/api/cloudflare/zones/:zoneId/dns/:recordId', requireAuth, rbac('operator'), async (req, res) => {
    try {
      assertId(req.params.zoneId, 'zone id');
      assertId(req.params.recordId, 'record id');
      const zone = await getZone(req.params.zoneId);
      const body = req.body ?? {};
      const patch = { ...body };
      if (body.name != null) patch.name = recordName(body.name, zone.name);
      const record = await updateDnsRecord(zone.id, req.params.recordId, patch);
      const existing = get('SELECT id, site_id FROM cloudflare_dns_records WHERE record_id = ?', [record.id]);
      if (existing) saveDnsRecordRow({ siteId: existing.site_id, zoneId: zone.id, zoneName: zone.name, record });
      auditLog(req, 'cloudflare.dns.update', record.name, { zone: zone.name });
      res.json({ ...record, managed: Boolean(existing) });
    } catch (e) {
      fail(res, e);
    }
  });

  app.delete('/api/cloudflare/zones/:zoneId/dns/:recordId', requireAuth, rbac('admin'), async (req, res) => {
    try {
      assertId(req.params.zoneId, 'zone id');
      assertId(req.params.recordId, 'record id');
      const row = get('SELECT * FROM cloudflare_dns_records WHERE record_id = ?', [req.params.recordId]);
      try {
        await deleteDnsRecord(req.params.zoneId, req.params.recordId);
      } catch (e) {
        if (e.status !== 404 && !/not found/i.test(e.message ?? '')) throw e;
      }
      run('DELETE FROM cloudflare_dns_records WHERE record_id = ?', [req.params.recordId]);
      auditLog(req, 'cloudflare.dns.delete', row?.record_name ?? req.params.recordId);
      res.json({ ok: true });
    } catch (e) {
      fail(res, e);
    }
  });

  app.get('/api/cloudflare/sites/:slug', requireAuth, rbac('operator'), (req, res) => {
    const site = get('SELECT id, slug, domain FROM sites WHERE slug = ?', [req.params.slug]);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const records = query(
      'SELECT * FROM cloudflare_dns_records WHERE site_id = ? ORDER BY record_name',
      [site.id],
    );
    res.json({ configured: tokenConfigured(), domain: site.domain, records });
  });

  app.delete('/api/cloudflare/sites/:slug', requireAuth, rbac('admin'), async (req, res) => {
    try {
      const site = get('SELECT id FROM sites WHERE slug = ?', [req.params.slug]);
      if (!site) return res.status(404).json({ error: 'Site not found' });
      const result = await removeSiteDns(site.id);
      auditLog(req, 'cloudflare.dns.cleanup', req.params.slug, result);
      res.json(result);
    } catch (e) {
      fail(res, e);
    }
  });
}
