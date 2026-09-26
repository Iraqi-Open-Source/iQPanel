import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth-context.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Badge from '../components/ui/Badge.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import DangerConfirmDialog from '../components/DangerConfirmDialog.jsx';
import { ChevronDown, ChevronRight } from 'lucide-react';

const SELECT_CLASS = 'h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm';

function canAdmin(role) {
  return role === 'owner' || role === 'admin';
}

export default function CloudflarePage() {
  const { user } = useAuth();
  const admin = canAdmin(user?.role);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['cloudflare-zones'],
    queryFn: () => api.get('/api/cloudflare/zones'),
    retry: false,
  });
  const { data: ipInfo } = useQuery({
    queryKey: ['cloudflare-server-ip'],
    queryFn: () => api.get('/api/cloudflare/server-ip'),
    enabled: Boolean(data?.configured),
    retry: false,
  });

  const [domainName, setDomainName] = useState('');
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState('');
  const [openZone, setOpenZone] = useState(null);

  async function addDomain(e) {
    e.preventDefault();
    setAdding(true);
    setFormError('');
    try {
      const zone = await api.post('/api/cloudflare/zones', { name: domainName.trim() });
      setDomainName('');
      setOpenZone(zone.id);
      qc.invalidateQueries(['cloudflare-zones']);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setAdding(false);
    }
  }

  if (isLoading) return <div className="flex justify-center py-16"><Spinner /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Cloudflare</h1>
          <p className="text-sm text-muted-foreground">Add domains and create DNS records from this server.</p>
        </div>
        {data?.configured && (
          <Badge variant="success">{data.zones?.length ?? 0} zones</Badge>
        )}
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error.message}</p>}

      {!data?.configured ? (
        <Card>
          <CardHeader><CardTitle>Connect Cloudflare</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Add a Cloudflare API token in Settings before managing domains.</p>
            <Button asChild size="sm"><Link to="/settings">Open settings</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {admin && (
            <Card>
              <CardHeader><CardTitle>Add domain</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={addDomain} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-64 flex-1 space-y-1.5">
                    <label htmlFor="cf-domain" className="text-sm font-medium">Domain</label>
                    <Input
                      id="cf-domain"
                      placeholder="example.com"
                      value={domainName}
                      onChange={(e) => setDomainName(e.target.value)}
                    />
                  </div>
                  <Button type="submit" loading={adding} disabled={!domainName.trim()}>Add domain</Button>
                </form>
                {formError && <p className="mt-3 text-sm text-destructive">{formError}</p>}
                <p className="mt-3 text-xs text-muted-foreground">
                  Cloudflare will assign nameservers. Point the registrar at those nameservers before records resolve.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Zones</CardTitle></CardHeader>
            <CardContent className="p-0">
              {(data.zones ?? []).length === 0 ? (
                <p className="px-6 py-6 text-sm text-muted-foreground">No domains in this Cloudflare account yet.</p>
              ) : (
                <div className="divide-y divide-border">
                  {data.zones.map((zone) => (
                    <ZoneRow
                      key={zone.id}
                      zone={zone}
                      open={openZone === zone.id}
                      onToggle={() => setOpenZone((id) => (id === zone.id ? null : zone.id))}
                      serverIp={ipInfo?.ip ?? ''}
                      admin={admin}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ZoneRow({ zone, open, onToggle, serverIp, admin }) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="font-medium">{zone.name}</span>
        <Badge variant={zone.status === 'active' ? 'success' : 'warning'}>{zone.status}</Badge>
        <span className="text-xs text-muted-foreground">{zone.record_count ?? 0} panel records</span>
        {zone.paused && <Badge variant="outline">Paused</Badge>}
      </button>
      {open && (
        <div className="space-y-4 border-t border-border bg-muted/20 px-4 py-4">
          {zone.name_servers?.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Nameservers: {zone.name_servers.join(', ')}
            </p>
          )}
          <ZoneRecords zone={zone} serverIp={serverIp} admin={admin} />
        </div>
      )}
    </div>
  );
}

function ZoneRecords({ zone, serverIp, admin }) {
  const qc = useQueryClient();
  const { data: records = [], isLoading, error } = useQuery({
    queryKey: ['cloudflare-dns', zone.id],
    queryFn: () => api.get(`/api/cloudflare/zones/${zone.id}/dns`),
  });
  const [managedOnly, setManagedOnly] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [type, setType] = useState('A');
  const [content, setContent] = useState(serverIp);
  useEffect(() => {
    if (serverIp) setContent((current) => current || serverIp);
  }, [serverIp]);
  const [proxied, setProxied] = useState(true);
  const [ttl, setTtl] = useState('1');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const shown = managedOnly ? records.filter((record) => record.managed) : records;
  const proxyable = type === 'A' || type === 'AAAA' || type === 'CNAME';

  async function createRecord(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await api.post(`/api/cloudflare/zones/${zone.id}/dns`, {
        type,
        name: prefix.trim(),
        content: content.trim(),
        proxied: proxyable ? proxied : false,
        ttl: Number(ttl) || 1,
      });
      setPrefix('');
      qc.invalidateQueries(['cloudflare-dns', zone.id]);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    setFormError('');
    try {
      await api.patch(`/api/cloudflare/zones/${zone.id}/dns/${editing.id}`, {
        content: editing.content,
        proxied: editing.proxied,
        ttl: Number(editing.ttl) || 1,
      });
      setEditing(null);
      qc.invalidateQueries(['cloudflare-dns', zone.id]);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function destroy() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/api/cloudflare/zones/${zone.id}/dns/${pendingDelete.id}`);
      setPendingDelete(null);
      qc.invalidateQueries(['cloudflare-dns', zone.id]);
    } catch (err) {
      setFormError(err.message);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={createRecord} className="grid gap-2 md:grid-cols-[1fr_7rem_1.4fr_auto_auto_auto] md:items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium">Subdomain</label>
          <div className="flex items-center gap-2">
            <Input placeholder="app" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
            <span className="shrink-0 text-sm text-muted-foreground">.{zone.name}</span>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Type</label>
          <select className={`${SELECT_CLASS} w-full`} value={type} onChange={(e) => {
            const next = e.target.value;
            setType(next);
            if (next === 'A' && serverIp && !content) setContent(serverIp);
          }}>
            {['A', 'AAAA', 'CNAME', 'TXT', 'MX'].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Content</label>
          <Input
            placeholder={type === 'A' ? serverIp || '203.0.113.10' : 'target'}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={proxyable && proxied} disabled={!proxyable} onChange={(e) => setProxied(e.target.checked)} />
          Proxied
        </label>
        <div className="space-y-1">
          <label className="text-xs font-medium">TTL</label>
          <Input className="w-20" value={ttl} onChange={(e) => setTtl(e.target.value)} />
        </div>
        <Button type="submit" loading={saving} disabled={!content.trim()}>Create</Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Leave the name empty to use the zone apex ({zone.name}). TTL 1 means automatic.
        {serverIp ? ` Server IP: ${serverIp}.` : ''}
      </p>
      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{isLoading ? 'Loading records…' : `${records.length} DNS records`}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={managedOnly} onChange={(e) => setManagedOnly(e.target.checked)} />
          Show only records created by iQPanel
        </label>
      </div>

      {isLoading ? <Spinner /> : error ? <p className="text-sm text-destructive">{error.message}</p> : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Content</th>
                <th className="px-3 py-2 font-medium">Proxy</th>
                <th className="px-3 py-2 font-medium text-right">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-4 text-muted-foreground">No DNS records.</td></tr>
              )}
              {shown.map((record) => (
                <tr key={record.id}>
                  <td className="px-3 py-2 font-mono text-xs">
                    {record.name}
                    {record.managed && <Badge className="ml-2" variant="secondary">Panel</Badge>}
                  </td>
                  <td className="px-3 py-2">{record.type}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {editing?.id === record.id ? (
                      <Input value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
                    ) : record.content}
                  </td>
                  <td className="px-3 py-2">
                    {editing?.id === record.id ? (
                      <input
                        type="checkbox"
                        checked={Boolean(editing.proxied)}
                        onChange={(e) => setEditing({ ...editing, proxied: e.target.checked })}
                      />
                    ) : (
                      record.proxied ? 'Proxied' : 'DNS only'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      {editing?.id === record.id ? (
                        <>
                          <Button size="sm" onClick={saveEdit} loading={saving}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setEditing({ ...record })}>Edit</Button>
                          {admin && (
                            <Button size="sm" variant="ghost" onClick={() => setPendingDelete(record)}>Delete</Button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DangerConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Delete DNS record?"
        description={pendingDelete ? `This removes ${pendingDelete.name} (${pendingDelete.type}) from Cloudflare.` : ''}
        confirmLabel="Delete record"
        loading={deleting}
        onConfirm={destroy}
      />
    </div>
  );
}
