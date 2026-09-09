import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Card, CardContent } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import Input from '../components/ui/Input.jsx';
import Spinner from '../components/ui/Spinner.jsx';

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

export default function DatabasesPage() {
  const qc = useQueryClient();
  const { data: dbs = [], isLoading } = useQuery({
    queryKey: ['databases'],
    queryFn:  () => api.get('/api/databases'),
  });
  const { data: engines = {} } = useQuery({
    queryKey: ['db-engines'],
    queryFn:  () => api.get('/api/databases/engines'),
    refetchInterval: 15_000,
  });

  const [form, setForm] = useState(null); // 'create' | 'import' | null
  const [engine, setEngine] = useState('mysql');
  const [dbName, setDbName] = useState('');
  const [dbUser, setDbUser] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyEngine, setBusyEngine] = useState(null);

  const sqlReady = useMemo(
    () => ENGINES.filter((e) => e.id !== 'redis' && engineStatus(engines, e.id).installed && engineStatus(engines, e.id).active),
    [engines],
  );

  const { data: existing = [], isFetching: loadingExisting } = useQuery({
    queryKey: ['db-existing', engine],
    queryFn:  () => api.get(`/api/databases/existing?engine=${encodeURIComponent(engine)}`),
    enabled: form === 'import' && sqlReady.some((e) => e.id === engine),
  });

  function openForm(mode, preferredEngine) {
    const first = preferredEngine && sqlReady.some((e) => e.id === preferredEngine)
      ? preferredEngine
      : sqlReady[0]?.id ?? 'mysql';
    setEngine(first);
    setDbName('');
    setDbUser('');
    setForm(mode);
  }

  async function create() {
    setLoading(true);
    try {
      await api.post('/api/databases', { engine, db_name: dbName, db_user: dbUser || dbName });
      qc.invalidateQueries(['databases']);
      qc.invalidateQueries(['db-existing']);
      setForm(null); setDbName(''); setDbUser('');
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }

  async function importExisting() {
    setLoading(true);
    try {
      await api.post('/api/databases/import', { engine, db_name: dbName, db_user: dbUser || dbName });
      qc.invalidateQueries(['databases']);
      qc.invalidateQueries(['db-existing']);
      setForm(null); setDbName(''); setDbUser('');
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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ENGINES.map((meta) => {
          const st = engineStatus(engines, meta.id);
          return (
            <div key={meta.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{meta.label}</p>
                <Badge variant={st.active ? 'success' : st.installed ? 'warning' : 'secondary'}>
                  {st.active ? 'active' : st.installed ? 'stopped' : 'not installed'}
                </Badge>
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
              </div>
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                    <Input value={dbUser} onChange={(e) => setDbUser(e.target.value)} placeholder="myapp_user" />
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                <div key={db.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="font-medium text-sm">{db.db_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {db.engine} · user: {db.db_user}
                      {enginePort(db.engine) ? ` · port ${enginePort(db.engine)}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Badge variant={db.granted ? 'success' : 'warning'}>{db.granted ? 'Granted' : 'Pending'}</Badge>
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
