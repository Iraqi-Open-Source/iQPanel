import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card.jsx';
import Button from './ui/Button.jsx';
import Input from './ui/Input.jsx';
import Badge from './ui/Badge.jsx';

function matchZone(domain, zones) {
  const host = String(domain ?? '').trim().toLowerCase();
  let best = null;
  for (const zone of zones) {
    const name = String(zone.name ?? '').toLowerCase();
    if (host === name || host.endsWith(`.${name}`)) {
      if (!best || name.length > best.name.length) best = zone;
    }
  }
  return best;
}

export default function SiteDnsPanel({ site }) {
  const qc = useQueryClient();
  const { data: cf } = useQuery({
    queryKey: ['cloudflare-zones'],
    queryFn: () => api.get('/api/cloudflare/zones'),
    staleTime: 60_000,
    retry: false,
  });
  const { data: siteDns, isLoading } = useQuery({
    queryKey: ['cloudflare-site', site.slug],
    queryFn: () => api.get(`/api/cloudflare/sites/${site.slug}`),
    enabled: Boolean(cf?.configured),
    retry: false,
  });

  const zone = useMemo(
    () => matchZone(site.domain, cf?.zones ?? []),
    [site.domain, cf?.zones],
  );
  const [prefix, setPrefix] = useState('');
  const [proxied, setProxied] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!cf?.configured) return null;

  const records = siteDns?.records ?? [];

  async function createSubdomain(e) {
    e.preventDefault();
    if (!zone) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const ip = await api.get('/api/cloudflare/server-ip');
      await api.post(`/api/cloudflare/zones/${zone.id}/dns`, {
        type: 'A',
        name: prefix.trim(),
        content: ip.ip,
        proxied,
        site_slug: site.slug,
      });
      setPrefix('');
      setNotice('Subdomain created.');
      qc.invalidateQueries(['cloudflare-site', site.slug]);
      qc.invalidateQueries(['cloudflare-dns', zone.id]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleProxy(record) {
    setError('');
    try {
      await api.patch(`/api/cloudflare/zones/${record.zone_id}/dns/${record.record_id}`, {
        proxied: !record.proxied,
      });
      qc.invalidateQueries(['cloudflare-site', site.slug]);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cloudflare DNS</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">
          Records created for this site. Manage every record on the <Link to="/cloudflare" className="text-primary hover:underline">Cloudflare page</Link>.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!site.domain && (
          <p className="text-sm text-muted-foreground">Add a domain in site settings before creating DNS records.</p>
        )}
        {site.domain && !zone && (
          <p className="text-sm text-muted-foreground">
            {site.domain} is not on a Cloudflare zone in this account.
          </p>
        )}
        {zone && (
          <form onSubmit={createSubdomain} className="flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1 space-y-1">
              <label className="text-xs font-medium">New subdomain</label>
              <div className="flex items-center gap-2">
                <Input placeholder="api" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
                <span className="shrink-0 text-sm text-muted-foreground">.{zone.name}</span>
              </div>
            </div>
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={proxied} onChange={(e) => setProxied(e.target.checked)} />
              Proxied
            </label>
            <Button type="submit" size="sm" loading={saving} disabled={!prefix.trim()}>Create subdomain</Button>
          </form>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && <p className="text-sm text-green-600">{notice}</p>}
        {isLoading ? <p className="text-sm text-muted-foreground">Loading DNS records…</p> : records.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Content</th>
                  <th className="px-3 py-2 font-medium">Proxy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {records.map((record) => (
                  <tr key={record.id}>
                    <td className="px-3 py-2 font-mono text-xs">{record.record_name}</td>
                    <td className="px-3 py-2">{record.record_type}</td>
                    <td className="px-3 py-2 font-mono text-xs">{record.record_content}</td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => toggleProxy(record)} className="inline-flex">
                        <Badge variant={record.proxied ? 'success' : 'outline'}>
                          {record.proxied ? 'Proxied' : 'DNS only'}
                        </Badge>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
