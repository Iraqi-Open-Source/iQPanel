import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth-context.jsx';
import { Card, CardContent } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import Input from '../components/ui/Input.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import { Copy, Check, Eye, EyeOff } from 'lucide-react';

const ENGINES = [
  { id: 'mysql',    label: 'MySQL',      pkg: 'mysql-server',    unit: 'mysql.service',       port: 3306 },
  { id: 'mariadb',  label: 'MariaDB',    pkg: 'mariadb-server',  unit: 'mariadb.service',     port: 3306 },
  { id: 'postgres', label: 'PostgreSQL', pkg: 'postgresql',       unit: 'postgresql.service',  port: 5432 },
  { id: 'redis',    label: 'Redis',      pkg: 'redis-server',    unit: 'redis-server.service', port: 6379 },
];

function enginePort(id) {
  return ENGINES.find((e) => e.id === id)?.port;
}

function engineStatus(engines, id) {
  const e = engines?.[id] ?? {};
  return {
    installed: Boolean(e.installed),
    active: Boolean(e.active),
  };
}

export async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  input.remove();
}

function CopyableSecret({ value }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!value) return;
    try {
      await copyText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div className="flex items-center gap-1">
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 font-mono text-[11px]">{value}</code>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 w-7 shrink-0 px-0"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy'}
      >
        {copied
          ? <Check className="h-3.5 w-3.5" aria-hidden="true" />
          : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      </Button>
    </div>
  );
}

function RedisPasswordButton() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState(null);
  const [configured, setConfigured] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    if (configured != null) {
      setOpen(true);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const r = await api.get('/api/databases/engines/redis/password');
      setConfigured(Boolean(r.configured));
      setPassword(r.password ?? '');
      setOpen(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button size="sm" variant="ghost" className="whitespace-nowrap" loading={loading} onClick={toggle}>
        {open
          ? <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          : <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {open ? 'Hide password' : 'Show password'}
      </Button>
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      {open && configured === false && (
        <p className="text-[11px] text-muted-foreground">No password set</p>
      )}
      {open && configured && <CopyableSecret value={password} />}
    </div>
  );
}

export function DbPasswordButton({ id, knownPassword }) {
  const [open, setOpen] = useState(Boolean(knownPassword));
  const [password, setPassword] = useState(knownPassword ?? null);
  const [configured, setConfigured] = useState(knownPassword ? true : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    if (configured != null) {
      setOpen(true);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const r = await api.get(`/api/databases/${id}/password`);
      setConfigured(Boolean(r.configured));
      setPassword(r.password ?? '');
      setOpen(true);
      if (r.rotated) setError('Password was reset so it can be stored again. Update any app .env that used the old one.');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button size="sm" variant="ghost" className="whitespace-nowrap" loading={loading} onClick={toggle}>
        {open
          ? <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          : <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {open ? 'Hide password' : 'Show password'}
      </Button>
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      {open && configured === false && (
        <p className="text-[11px] text-muted-foreground">No password stored</p>
      )}
      {open && configured && <CopyableSecret value={password} />}
    </div>
  );
}

export function HealthBadge({ result }) {
  if (!result) return null;
  if (result.loading) return <Badge variant="secondary">checking</Badge>;
  if (result.ok) return <Badge variant="success">healthy</Badge>;
  return (
    <span className="flex flex-col items-end gap-0.5">
      <Badge variant="destructive">unhealthy</Badge>
      {result.error ? <span className="max-w-[16rem] text-right text-[11px] text-destructive">{result.error}</span> : null}
    </span>
  );
}

export function CreatedCredsBanner({ creds, onDismiss, envError }) {
  if (!creds) return null;
  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Database created — copy the password now</p>
        {onDismiss ? <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button> : null}
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Database</p>
          <code className="font-mono text-xs">{creds.db_name}</code>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Username</p>
          <code className="font-mono text-xs">{creds.db_user}</code>
        </div>
      </div>
      <div>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Password</p>
        <CopyableSecret value={creds.db_pass} />
      </div>
      {envError ? <p className="text-[11px] text-destructive">.env not updated: {envError}</p> : null}
    </div>
  );
}

export default function DatabasesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canViewSecrets = ['owner', 'admin', 'operator'].includes(user?.role);
  const { data: dbs = [], isLoading } = useQuery({
    queryKey: ['databases'],
    queryFn:  () => api.get('/api/databases'),
  });
  const { data: engines = {} } = useQuery({
    queryKey: ['db-engines'],
    queryFn:  () => api.get('/api/databases/engines'),
    refetchInterval: 15_000,
  });

  const [form, setForm] = useState(null);
  const [engine, setEngine] = useState('mysql');
  const [dbName, setDbName] = useState('');
  const [dbUser, setDbUser] = useState('');
  const [dbPass, setDbPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyEngine, setBusyEngine] = useState(null);
  const [engineHealth, setEngineHealth] = useState({});
  const [dbHealth, setDbHealth] = useState({});
  const [createdCreds, setCreatedCreds] = useState(null);

  const sqlReady = useMemo(
    () => ENGINES.filter((e) => e.id !== 'redis' && engineStatus(engines, e.id).installed && engineStatus(engines, e.id).active),
    [engines],
  );

  const { data: existing = [], isFetching: loadingExisting } = useQuery({
    queryKey: ['db-existing', engine],
    queryFn:  () => api.get(`/api/databases/existing?engine=${encodeURIComponent(engine)}`),
    enabled: form === 'import' && sqlReady.some((e) => e.id === engine),
  });

  function resetFormFields() {
    setDbName('');
    setDbUser('');
    setDbPass('');
  }

  function openForm(mode, preferredEngine) {
    const first = preferredEngine && sqlReady.some((e) => e.id === preferredEngine)
      ? preferredEngine
      : sqlReady[0]?.id ?? 'mysql';
    setEngine(first);
    resetFormFields();
    setForm(mode);
  }

  async function create() {
    setLoading(true);
    try {
      const body = { engine, db_name: dbName };
      if (dbUser.trim()) body.db_user = dbUser.trim();
      if (dbPass) body.db_pass = dbPass;
      const r = await api.post('/api/databases', body);
      qc.invalidateQueries(['databases']);
      qc.invalidateQueries(['db-existing']);
      setCreatedCreds({ db_name: r.db_name, db_user: r.db_user, db_pass: r.db_pass });
      setForm(null);
      resetFormFields();
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }

  async function importExisting() {
    setLoading(true);
    try {
      const body = { engine, db_name: dbName, db_user: dbUser || dbName };
      if (dbPass) body.db_pass = dbPass;
      await api.post('/api/databases/import', body);
      qc.invalidateQueries(['databases']);
      qc.invalidateQueries(['db-existing']);
      setForm(null);
      resetFormFields();
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }

  async function drop(db) {
    if (!confirm(`Drop ${db.db_name}? This is irreversible.`)) return;
    await api.delete(`/api/databases/${db.id}`);
    qc.invalidateQueries(['databases']);
    qc.invalidateQueries(['db-existing']);
  }

  async function installEngine(id) {
    setBusyEngine(id);
    try {
      await api.post(`/api/databases/engines/${id}/install`, {});
      qc.invalidateQueries(['db-engines']);
      qc.invalidateQueries(['services']);
    } catch (e) { alert(e.message); }
    finally { setBusyEngine(null); }
  }

  async function controlEngine(unit, act) {
    setBusyEngine(unit);
    try {
      await api.post(`/api/services/${encodeURIComponent(unit)}/${act}`, {});
      qc.invalidateQueries(['db-engines']);
      qc.invalidateQueries(['services']);
    } catch (e) { alert(e.message); }
    finally { setBusyEngine(null); }
  }

  async function testEngineHealth(id) {
    setEngineHealth((h) => ({ ...h, [id]: { loading: true } }));
    try {
      const r = await api.post(`/api/databases/engines/${id}/health`, {});
      setEngineHealth((h) => ({ ...h, [id]: { ok: Boolean(r.ok), error: r.error } }));
    } catch (e) {
      setEngineHealth((h) => ({ ...h, [id]: { ok: false, error: e.message } }));
    }
  }

  async function testDbHealth(id) {
    setDbHealth((h) => ({ ...h, [id]: { loading: true } }));
    try {
      const r = await api.post(`/api/databases/${id}/health`, {});
      setDbHealth((h) => ({ ...h, [id]: { ok: Boolean(r.ok), error: r.error } }));
    } catch (e) {
      setDbHealth((h) => ({ ...h, [id]: { ok: false, error: e.message } }));
    }
  }

  if (isLoading) return <div className="flex justify-center p-16"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Databases</h1>
        <div className="flex gap-2">
          <Button variant="outline" disabled={sqlReady.length === 0} onClick={() => openForm('import')}>
            Add existing
          </Button>
          <Button onClick={() => setForm(form === 'create' ? null : 'create')}>
            {form === 'create' ? 'Cancel' : '+ New database'}
          </Button>
        </div>
      </div>

      <CreatedCredsBanner creds={createdCreds} onDismiss={() => setCreatedCreds(null)} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ENGINES.map((meta) => {
          const st = engineStatus(engines, meta.id);
          return (
            <div key={meta.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{meta.label}</p>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant={st.active ? 'success' : st.installed ? 'warning' : 'secondary'}>
                    {st.active ? 'active' : st.installed ? 'stopped' : 'not installed'}
                  </Badge>
                  <HealthBadge result={engineHealth[meta.id]} />
                </div>
              </div>
              <p className="font-mono text-[11px] text-muted-foreground truncate">{meta.unit}</p>
              <p className="text-[11px] text-muted-foreground">Port {meta.port}</p>
              <div className="flex flex-wrap gap-1">
                {!st.installed && (
                  <Button size="sm" variant="outline" loading={busyEngine === meta.id} onClick={() => installEngine(meta.id)}>
                    Install
                  </Button>
                )}
                {st.installed && !st.active && (
                  <Button size="sm" variant="outline" loading={busyEngine === meta.unit} onClick={() => controlEngine(meta.unit, 'start')}>
                    Start
                  </Button>
                )}
                {st.active && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => controlEngine(meta.unit, 'restart')} loading={busyEngine === meta.unit}>
                      Restart
                    </Button>
                    {meta.id !== 'redis' && (
                      <Button size="sm" variant="ghost" onClick={() => openForm('create', meta.id)}>
                        New DB
                      </Button>
                    )}
                  </>
                )}
                {st.installed && (
                  <Button size="sm" variant="outline" loading={engineHealth[meta.id]?.loading} onClick={() => testEngineHealth(meta.id)}>
                    Test health
                  </Button>
                )}
              </div>
              {meta.id === 'redis' && st.installed && canViewSecrets && (
                <RedisPasswordButton />
              )}
            </div>
          );
        })}
      </div>

      {form === 'create' && (
        <Card>
          <CardContent className="p-6 space-y-3">
            {sqlReady.length === 0 ? (
              <p className="text-sm text-muted-foreground">Install and start MySQL, MariaDB, or PostgreSQL first.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Username and password are optional. Empty user defaults to the database name; empty password is generated.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="text-xs font-medium block mb-1">Engine</label>
                    <select className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={engine} onChange={(e) => setEngine(e.target.value)}>
                      {sqlReady.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1">Database name</label>
                    <Input value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder="myapp_production" />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1">Username</label>
                    <Input value={dbUser} onChange={(e) => setDbUser(e.target.value)} placeholder="defaults to database name" />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1">Password</label>
                    <Input type="password" value={dbPass} onChange={(e) => setDbPass(e.target.value)} placeholder="auto-generated" autoComplete="new-password" />
                  </div>
                </div>
                <Button loading={loading} onClick={create} disabled={!dbName}>Create</Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {form === 'import' && (
        <Card>
          <CardContent className="p-6 space-y-3">
            {sqlReady.length === 0 ? (
              <p className="text-sm text-muted-foreground">No running SQL engine. Start one above, then import.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Register a database that already exists on the server without creating it again.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="text-xs font-medium block mb-1">Engine</label>
                    <select className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={engine} onChange={(e) => { setEngine(e.target.value); setDbName(''); }}>
                      {sqlReady.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1">Existing database</label>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                      value={dbName}
                      onChange={(e) => { setDbName(e.target.value); if (!dbUser) setDbUser(e.target.value); }}
                      disabled={loadingExisting}
                    >
                      <option value="">{loadingExisting ? 'Loading…' : existing.length ? 'Select…' : 'No untracked databases'}</option>
                      {existing.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1">Username</label>
                    <Input value={dbUser} onChange={(e) => setDbUser(e.target.value)} placeholder="existing_user" />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1">Password</label>
                    <Input type="password" value={dbPass} onChange={(e) => setDbPass(e.target.value)} placeholder="optional, for health checks" autoComplete="new-password" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button loading={loading} onClick={importExisting} disabled={!dbName}>Import</Button>
                  <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {dbs.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No databases tracked yet. Create one or import an existing database.</p> : (
            <div className="divide-y divide-border">
              {dbs.map((db) => (
                <div key={db.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <p className="font-medium text-sm">{db.db_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {db.engine} · user: {db.db_user}
                      {enginePort(db.engine) ? ` · port ${enginePort(db.engine)}` : ''}
                    </p>
                    {canViewSecrets ? (
                      <DbPasswordButton
                        id={db.id}
                        knownPassword={createdCreds?.db_name === db.db_name ? createdCreds.db_pass : undefined}
                      />
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <Badge variant={db.granted ? 'success' : 'warning'}>{db.granted ? 'Granted' : 'Pending'}</Badge>
                    <HealthBadge result={dbHealth[db.id]} />
                    <Button size="sm" variant="outline" loading={dbHealth[db.id]?.loading} onClick={() => testDbHealth(db.id)}>
                      Healthy
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => drop(db)}>Drop</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
