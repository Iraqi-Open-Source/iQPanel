import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, subscribeSSE } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import Input from '../components/ui/Input.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import { formatBytes, timeAgo } from '../lib/utils.js';
import {
  Play, RefreshCw, ArrowLeft, Copy, Terminal, FileText,
  Database, Clock, Shield, Archive, Globe, AlertCircle,
  CheckCircle, ChevronRight, Settings, RotateCcw,
} from 'lucide-react';

const TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'commands',    label: 'Commands' },
  { id: 'env',         label: 'Environment' },
  { id: 'deployments', label: 'Deployments' },
  { id: 'databases',   label: 'Databases' },
  { id: 'files',       label: 'Files' },
  { id: 'queues',      label: 'Queues & Scheduler' },
  { id: 'cron',        label: 'Cron' },
  { id: 'logs',        label: 'Logs' },
  { id: 'ssl',         label: 'SSL' },
  { id: 'terminal',    label: 'Terminal' },
];

const SHORTCUTS = [
  { label: 'Migrate',        cmd: 'php artisan migrate' },
  { label: 'Migrate status', cmd: 'php artisan migrate:status' },
  { label: 'Optimize clear', cmd: 'php artisan optimize:clear' },
  { label: 'Config cache',   cmd: 'php artisan config:cache' },
  { label: 'Route cache',    cmd: 'php artisan route:cache' },
  { label: 'View cache',     cmd: 'php artisan view:cache' },
  { label: 'Cache clear',    cmd: 'php artisan cache:clear' },
  { label: 'Storage link',   cmd: 'php artisan storage:link' },
  { label: 'Queue restart',  cmd: 'php artisan queue:restart' },
  { label: 'Optimize',       cmd: 'php artisan optimize' },
  { label: 'Up',             cmd: 'php artisan up' },
  { label: 'Down',           cmd: 'php artisan down' },
  { label: 'Composer install', cmd: 'composer install --no-dev --optimize-autoloader --no-interaction' },
  { label: 'npm build',      cmd: 'npm run build', destructive: false },
  { label: 'Migrate fresh ⚠', cmd: 'php artisan migrate:fresh', destructive: true },
];

export default function SiteDetailPage() {
  const { slug, tab = 'overview' } = useParams();
  const navigate    = useNavigate();
  const qc          = useQueryClient();
  const [activeTab, setActiveTab] = useState(tab);

  const { data: site, isLoading } = useQuery({
    queryKey: ['site', slug],
    queryFn: () => api.get(`/api/sites/${slug}`),
  });

  useEffect(() => { setActiveTab(tab); }, [tab]);

  if (isLoading) return <div className="flex justify-center p-16"><Spinner size="lg" /></div>;
  if (!site)     return <div className="p-8 text-center text-muted-foreground">Site not found.</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/sites" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
        <div>
          <h1 className="text-xl font-bold">{site.name}</h1>
          <p className="text-sm text-muted-foreground">{site.slug} · {site.type}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Badge variant={site.status === 'online' ? 'success' : site.status === 'error' ? 'destructive' : 'secondary'}>
            {site.status}
          </Badge>
          <Button size="sm" onClick={() => api.post(`/api/sites/${slug}/deploy`, {}).then(() => qc.invalidateQueries(['site', slug]))}>
            <RefreshCw className="h-3 w-3" /> Deploy
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border pb-0">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => { setActiveTab(id); navigate(`/sites/${slug}/${id}`, { replace: true }); }}
            className={`shrink-0 px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview'    && <OverviewTab    site={site} />}
      {activeTab === 'commands'    && <CommandsTab    site={site} />}
      {activeTab === 'env'         && <EnvTab         site={site} />}
      {activeTab === 'deployments' && <DeploymentsTab site={site} />}
      {activeTab === 'databases'   && <DatabasesTab   site={site} />}
      {activeTab === 'files'       && <FilesTab       site={site} />}
      {activeTab === 'queues'      && <QueuesTab       site={site} />}
      {activeTab === 'cron'        && <CronTab        site={site} />}
      {activeTab === 'logs'        && <LogsTab        site={site} />}
      {activeTab === 'ssl'         && <SSLTab         site={site} />}
      {activeTab === 'terminal'    && <TerminalTab    site={site} />}
    </div>
  );
}

/* ──────────────────────────────────────────────── */
/* Overview                                         */
/* ──────────────────────────────────────────────── */
function OverviewTab({ site }) {
  const { data: commit } = useQuery({
    queryKey: ['commit', site.slug],
    queryFn: () => api.get(`/api/sites/${site.slug}/deployments`).then((d) => d[0] ?? null),
  });

  function copy(t) { navigator.clipboard.writeText(t); }

  const paths = [
    { label: 'App root',    value: site.directory ? `${site.directory}/app`      : '—' },
    { label: 'Site user',   value: site.run_as_user || '—' },
    { label: 'Deploy key',  value: site.deploy_key_pub ? site.deploy_key_pub.slice(0, 50) + '…' : '—' },
    { label: 'Nginx vhost', value: `/etc/nginx/sites-available/${site.slug}.conf` },
    { label: 'PHP pool',    value: `/etc/php/${site.php_version}/fpm/pool.d/${site.slug}.conf` },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Site Info</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Domain/Port"  value={site.domain ?? `Port ${site.port}`} />
          <Row label="PHP version"  value={`PHP ${site.php_version}`} />
          <Row label="Web server"   value={site.webserver} />
          <Row label="SSL"          value={site.ssl_status} />
          <Row label="Deploy branch" value={site.deploy_branch} />
          <Row label="Created"      value={timeAgo(site.created_at)} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Last Deployment</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {commit ? (
            <div className="space-y-2">
              <Row label="Status"  value={commit.status} />
              <Row label="Commit"  value={commit.commit_sha?.slice(0, 8) ?? '—'} />
              <Row label="By"      value={commit.triggered_by} />
              <Row label="When"    value={timeAgo(commit.created_at)} />
            </div>
          ) : <p className="text-muted-foreground">No deployments yet.</p>}
        </CardContent>
      </Card>
      <Card className="sm:col-span-2">
        <CardHeader><CardTitle className="text-base">Paths</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {paths.map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
              <code className="text-xs flex-1 truncate">{value}</code>
              <button onClick={() => copy(value)} className="text-muted-foreground hover:text-foreground"><Copy className="h-3 w-3" /></button>
            </div>
          ))}
        </CardContent>
      </Card>
      {site.type === 'laravel' && (
        <Card className="sm:col-span-2">
          <CardHeader><CardTitle className="text-base">Quick Actions</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {SHORTCUTS.slice(0, 8).map(({ label, cmd }) => (
                <ShortcutButton key={cmd} slug={site.slug} cmd={cmd} label={label} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────── */
/* Commands                                         */
/* ──────────────────────────────────────────────── */
function CommandsTab({ site }) {
  const [cmd, setCmd]       = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const outputRef = useRef(null);

  async function runCmd(command) {
    if (!command) return;
    setOutput('');
    setRunning(true);
    const cleanup = subscribeSSE(`/api/sites/${site.slug}/exec`, {
      stdout: (d) => setOutput((o) => o + d.line),
      stderr: (d) => setOutput((o) => o + d.line),
      done:   () => { setRunning(false); cleanup(); },
      error:  (d) => { setOutput((o) => o + `\nError: ${d.message}`); setRunning(false); cleanup(); },
    });

    // POST first, then SSE picks up
    try {
      await api.post(`/api/sites/${site.slug}/exec`, { cmd: command });
    } catch (e) {
      setOutput(`Error: ${e.message}`);
      setRunning(false);
    }
  }

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);

  return (
    <div className="space-y-4">
      {/* Shortcuts */}
      {site.type === 'laravel' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Quick shortcuts</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {SHORTCUTS.map(({ label, cmd: c, destructive }) => (
                <ShortcutButton key={c} slug={site.slug} cmd={c} label={label} destructive={destructive} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Custom command */}
      <Card>
        <CardHeader><CardTitle className="text-base">Run command</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              className="font-mono"
              placeholder="php artisan …"
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !running && runCmd(cmd)}
            />
            <Button onClick={() => runCmd(cmd)} loading={running} disabled={!cmd}>
              <Play className="h-4 w-4" />
            </Button>
          </div>
          <pre
            ref={outputRef}
            className="h-72 overflow-y-auto rounded-lg bg-gray-950 p-3 text-xs text-green-400 font-mono whitespace-pre-wrap"
          >
            {output || (running ? 'Running…\n' : 'Output will appear here.')}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

/* ──────────────────────────────────────────────── */
/* Environment Editor                               */
/* ──────────────────────────────────────────────── */
function EnvTab({ site }) {
  const [content, setContent] = useState('');
  const [saved, setSaved]     = useState(false);
  const [loading, setLoading] = useState(false);

  useQuery({
    queryKey: ['env', site.slug],
    queryFn:  () => api.get(`/api/sites/${site.slug}/env`),
    onSuccess: (d) => setContent(d.content ?? ''),
  });

  async function save() {
    setLoading(true);
    try {
      await api.put(`/api/sites/${site.slug}/env`, { content });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setLoading(false); }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">.env editor</CardTitle>
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Saved</span>}
            <Button size="sm" onClick={save} loading={loading}>Save</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <textarea
          className="w-full rounded-md border border-input bg-gray-950 text-green-400 font-mono text-xs p-3 h-[500px] resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
        />
        <p className="mt-2 text-xs text-muted-foreground">Changes are saved immediately to disk. Run <code>php artisan config:clear</code> after editing.</p>
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────────── */
/* Deployments                                      */
/* ──────────────────────────────────────────────── */
function DeploymentsTab({ site }) {
  const qc = useQueryClient();
  const { data: deploys = [] } = useQuery({
    queryKey: ['deployments', site.slug],
    queryFn:  () => api.get(`/api/sites/${site.slug}/deployments`),
    refetchInterval: 5000,
  });

  async function rollback(id) {
    try {
      await api.post(`/api/deployments/${id}/rollback`, {});
      qc.invalidateQueries(['deployments', site.slug]);
    } catch (e) { alert(e.message); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Deployment History</CardTitle></CardHeader>
      <CardContent>
        {deploys.length === 0 ? <p className="text-sm text-muted-foreground">No deployments yet.</p> : (
          <div className="divide-y divide-border">
            {deploys.map((d) => (
              <div key={d.id} className="flex items-center justify-between py-3">
                <div className="text-sm space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Badge variant={d.status === 'success' ? 'success' : d.status === 'failed' ? 'destructive' : 'secondary'}>{d.status}</Badge>
                    <code className="text-xs">{d.commit_sha?.slice(0, 8) ?? '—'}</code>
                    <span className="text-muted-foreground text-xs">{d.commit_msg?.slice(0, 60)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{d.triggered_by} · {timeAgo(d.created_at)}</p>
                </div>
                {d.status === 'success' && d.commit_sha && (
                  <Button size="sm" variant="outline" onClick={() => rollback(d.id)}>
                    <RotateCcw className="h-3 w-3" /> Rollback
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────────── */
/* Databases                                        */
/* ──────────────────────────────────────────────── */
function DatabasesTab({ site }) {
  const { data: dbs = [] } = useQuery({
    queryKey: ['site-dbs', site.slug],
    queryFn:  () => api.get(`/api/sites/${site.slug}/databases`),
  });
  const { data: engines = {} } = useQuery({
    queryKey: ['db-engines'],
    queryFn:  () => api.get('/api/databases/engines'),
    staleTime: 15_000,
  });
  const ready = ['mysql', 'mariadb', 'postgres'].filter((id) => engines[id]?.installed && engines[id]?.active);
  const [showForm, setShowForm] = useState(false);
  const [engine, setEngine] = useState('mysql');
  const [dbName, setDbName] = useState('');
  const [dbUser, setDbUser] = useState('');
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  async function create() {
    setLoading(true);
    try {
      await api.post('/api/databases', { site_slug: site.slug, engine, db_name: dbName, db_user: dbUser, inject_env: true });
      qc.invalidateQueries(['site-dbs', site.slug]);
      setShowForm(false);
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Databases</CardTitle>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ Add database'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-medium">Engine</label>
                <select className="h-8 w-full rounded border border-input bg-transparent text-sm px-2" value={engine} onChange={(e) => setEngine(e.target.value)}>
                  {ready.length === 0 && <option value="">No engine running</option>}
                  {ready.includes('mysql') && <option value="mysql">MySQL</option>}
                  {ready.includes('mariadb') && <option value="mariadb">MariaDB</option>}
                  {ready.includes('postgres') && <option value="postgres">PostgreSQL</option>}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Database name</label>
                <Input className="h-8 text-xs" value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder="myapp_db" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Username</label>
                <Input className="h-8 text-xs" value={dbUser} onChange={(e) => setDbUser(e.target.value)} placeholder="myapp_user" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Credentials will be injected into .env automatically.</p>
            <Button size="sm" onClick={create} loading={loading} disabled={!engine || !dbName}>Create database</Button>
          </div>
        )}
        {dbs.length === 0 ? <p className="text-sm text-muted-foreground">No databases yet.</p> : (
          <div className="divide-y divide-border">
            {dbs.map((db) => (
              <div key={db.id} className="py-2 text-sm flex items-center justify-between">
                <div>
                  <span className="font-medium">{db.db_name}</span>
                  <span className="ml-2 text-muted-foreground text-xs">{db.engine} · {db.db_user}</span>
                </div>
                <Badge variant={db.granted ? 'success' : 'warning'}>{db.granted ? 'Granted' : 'Pending'}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────────── */
/* Files                                            */
/* ──────────────────────────────────────────────── */
function FilesTab({ site }) {
  const [path, setPath]   = useState('.');
  const [selected, setSelected] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data: entries = [] } = useQuery({
    queryKey: ['files', site.slug, path],
    queryFn:  () => api.get(`/api/sites/${site.slug}/files?path=${encodeURIComponent(path)}`),
  });

  async function openFile(entry) {
    if (entry.isDir) { setPath(path === '.' ? entry.name : `${path}/${entry.name}`); return; }
    setSelected(entry);
    const result = await api.get(`/api/sites/${site.slug}/files/read?path=${encodeURIComponent(path === '.' ? entry.name : `${path}/${entry.name}`)}`);
    setFileContent(result.content ?? '');
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      await api.put(`/api/sites/${site.slug}/files`, {
        path: path === '.' ? selected.name : `${path}/${selected.name}`,
        content: fileContent,
      });
      qc.invalidateQueries(['files', site.slug]);
    } finally { setSaving(false); }
  }

  return (
    <div className="grid grid-cols-3 gap-4 h-[600px]">
      <Card className="overflow-auto">
        <CardHeader className="p-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <button onClick={() => setPath('.')} className="hover:text-foreground">root</button>
            {path !== '.' && path.split('/').map((seg, i, arr) => (
              <React.Fragment key={i}>
                <ChevronRight className="h-3 w-3" />
                <button onClick={() => setPath(arr.slice(0, i + 1).join('/'))} className="hover:text-foreground">{seg}</button>
              </React.Fragment>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {entries.map((e) => (
            <button
              key={e.name}
              onClick={() => openFile(e)}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2"
            >
              <span>{e.isDir ? '📁' : '📄'}</span>
              <span className="flex-1 truncate">{e.name}</span>
              {!e.isDir && <span className="text-xs text-muted-foreground">{formatBytes(e.size)}</span>}
            </button>
          ))}
        </CardContent>
      </Card>
      <Card className="col-span-2 flex flex-col">
        {selected ? (
          <>
            <CardHeader className="p-3 flex-row items-center justify-between">
              <span className="text-sm font-medium">{selected.name}</span>
              <Button size="sm" onClick={save} loading={saving}>Save</Button>
            </CardHeader>
            <CardContent className="flex-1 p-0">
              <textarea
                className="w-full h-full bg-gray-950 text-green-400 font-mono text-xs p-3 resize-none focus:outline-none"
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
                spellCheck={false}
              />
            </CardContent>
          </>
        ) : (
          <CardContent className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Select a file to edit
          </CardContent>
        )}
      </Card>
    </div>
  );
}

/* ──────────────────────────────────────────────── */
/* Queues & Scheduler                               */
/* ──────────────────────────────────────────────── */
function QueuesTab({ site }) {
  const qc = useQueryClient();
  const { data: units = [] } = useQuery({
    queryKey: ['queues', site.slug],
    queryFn:  () => api.get(`/api/sites/${site.slug}/queues`),
  });
  const { data: scheduler } = useQuery({
    queryKey: ['scheduler', site.slug],
    queryFn:  () => api.get(`/api/sites/${site.slug}/scheduler`),
  });

  async function addWorker() {
    await api.post(`/api/sites/${site.slug}/queues`, { template: 'queue' });
    qc.invalidateQueries(['queues', site.slug]);
  }
  async function addHorizon() {
    await api.post(`/api/sites/${site.slug}/queues`, { template: 'horizon' });
    qc.invalidateQueries(['queues', site.slug]);
  }
  async function enableScheduler() {
    await api.post(`/api/sites/${site.slug}/scheduler`, {});
    qc.invalidateQueries(['scheduler', site.slug]);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Queue Workers</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={addWorker}>+ queue:work</Button>
              <Button size="sm" variant="outline" onClick={addHorizon}>+ Horizon</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {units.length === 0 ? <p className="text-sm text-muted-foreground">No queue workers running.</p> : (
            <div className="divide-y divide-border">
              {units.map((u) => (
                <div key={u.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <span className="font-mono text-xs">{u.unit_name}</span>
                    <Badge className="ml-2" variant={u.status === 'running' ? 'success' : 'secondary'}>{u.status}</Badge>
                  </div>
                  <div className="flex gap-1">
                    {['start','stop','restart'].map((a) => (
                      <Button key={a} size="sm" variant="outline" onClick={async () => {
                        await api.post(`/api/sites/${site.slug}/queues/${u.id}/${a}`, {});
                        qc.invalidateQueries(['queues', site.slug]);
                      }}>{a}</Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Laravel Scheduler</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {scheduler?.configured ? (
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm">Scheduler cron is configured (<code>* * * * *</code>)</span>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Add a crontab entry for <code>php artisan schedule:run</code>.</p>
              <Button size="sm" onClick={enableScheduler}>Enable scheduler</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ──────────────────────────────────────────────── */
/* Cron                                             */
/* ──────────────────────────────────────────────── */
function CronTab({ site }) {
  const qc = useQueryClient();
  const { data: jobs = [] } = useQuery({
    queryKey: ['site-cron', site.slug],
    queryFn:  () => api.get(`/api/sites/${site.slug}/cron`),
  });
  const [schedule, setSchedule] = useState('');
  const [cmd, setCmd]           = useState('');
  const [loading, setLoading]   = useState(false);

  async function add() {
    setLoading(true);
    try {
      await api.post('/api/cron', { site_slug: site.slug, schedule, command: cmd });
      qc.invalidateQueries(['site-cron', site.slug]);
      setSchedule(''); setCmd('');
    } finally { setLoading(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Cron Jobs</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input className="w-36 font-mono text-xs" placeholder="* * * * *" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
          <Input className="flex-1 font-mono text-xs" placeholder="php artisan …" value={cmd} onChange={(e) => setCmd(e.target.value)} />
          <Button size="sm" onClick={add} loading={loading}>Add</Button>
        </div>
        {jobs.length === 0 ? <p className="text-sm text-muted-foreground">No cron jobs.</p> : (
          <div className="divide-y divide-border">
            {jobs.map((j) => (
              <div key={j.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <code className="text-xs mr-2">{j.schedule}</code>
                  <span>{j.command}</span>
                </div>
                <Button size="sm" variant="destructive" onClick={async () => {
                  await api.delete(`/api/cron/${j.id}`);
                  qc.invalidateQueries(['site-cron', site.slug]);
                }}>Remove</Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────────── */
/* Logs                                             */
/* ──────────────────────────────────────────────── */
function LogsTab({ site }) {
  const { data: logs = [] } = useQuery({
    queryKey: ['site-logs', site.slug],
    queryFn:  () => api.get(`/api/sites/${site.slug}/logs`),
  });
  const [selected, setSelected] = useState(null);
  const [content, setContent]   = useState('');
  const [tailing, setTailing]   = useState(false);
  const tailRef = useRef(null);

  async function open(log) {
    setSelected(log);
    const text = await fetch(log.path.replace('/var/log/nginx/', '/api/logs/nginx/')).then((r) => r.text()).catch(() => '');
    setContent(text);
  }

  return (
    <div className="grid grid-cols-3 gap-4 h-[500px]">
      <Card className="overflow-auto">
        <CardHeader className="p-3"><p className="text-xs font-medium text-muted-foreground">Log files</p></CardHeader>
        <CardContent className="p-0">
          {logs.map((l) => (
            <button key={l.name} onClick={() => open(l)}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-accent ${selected?.name === l.name ? 'bg-accent' : ''}`}>
              {l.name}<span className="float-right text-muted-foreground">{formatBytes(l.size)}</span>
            </button>
          ))}
        </CardContent>
      </Card>
      <Card className="col-span-2">
        <CardContent className="p-0 h-full">
          <pre className="h-full overflow-y-auto bg-gray-950 text-green-400 text-xs font-mono p-3 whitespace-pre-wrap">
            {content || (selected ? 'Empty log.' : 'Select a log file.')}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

/* ──────────────────────────────────────────────── */
/* SSL                                              */
/* ──────────────────────────────────────────────── */
function SSLTab({ site }) {
  const qc = useQueryClient();
  const [email, setEmail]   = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  async function issue() {
    if (!email) return;
    setLoading(true); setOutput('');
    const cleanup = subscribeSSE(`/api/sites/${site.slug}/ssl/issue`, {
      stdout: (d) => setOutput((o) => o + d.line),
      done:   () => { cleanup(); setLoading(false); qc.invalidateQueries(['site', site.slug]); },
      error:  (d) => { setOutput((o) => o + `Error: ${d.message}`); cleanup(); setLoading(false); },
    });
    await api.post(`/api/sites/${site.slug}/ssl/issue`, { email }).catch(() => {});
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">SSL Certificate</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {!site.domain ? (
          <p className="text-sm text-muted-foreground">Set a domain on this site to issue an SSL certificate.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-sm">Domain: <strong>{site.domain}</strong></span>
              <Badge variant={site.ssl_status === 'active' ? 'success' : 'secondary'}>{site.ssl_status}</Badge>
            </div>
            <div className="flex gap-2">
              <Input className="flex-1" type="email" placeholder="admin@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Button size="sm" onClick={issue} loading={loading}>Issue cert</Button>
            </div>
            {output && <pre className="rounded-md bg-gray-950 text-green-400 font-mono text-xs p-3 h-48 overflow-y-auto">{output}</pre>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────────── */
/* Terminal                                         */
/* ──────────────────────────────────────────────── */
function TerminalTab({ site }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let term, ws;
    (async () => {
      const { Terminal }  = await import('@xterm/xterm');
      const { FitAddon }  = await import('@xterm/addon-fit');
      term = new Terminal({ cursorBlink: true, theme: { background: '#030712', foreground: '#4ade80' } });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(ref.current);
      fit.fit();
      setReady(true);

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}/api/terminal/connect?site=${site.slug}`);
      ws.onmessage  = (e) => term.write(e.data);
      ws.onclose    = () => term.write('\r\n[Session closed]\r\n');
      term.onData   = (data) => ws.readyState === WebSocket.OPEN && ws.send(data);

      window.addEventListener('resize', () => fit.fit());
    })();

    return () => { ws?.close(); term?.dispose(); };
  }, [site.slug]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-3">
        <p className="text-xs text-muted-foreground">Terminal — running as <code>{site.run_as_user || site.slug}</code></p>
      </CardHeader>
      <CardContent className="p-0">
        <div ref={ref} className="h-[500px] w-full bg-gray-950" />
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────────── */
/* Shared helpers                                   */
/* ──────────────────────────────────────────────── */
function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function ShortcutButton({ slug, cmd, label, destructive }) {
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);

  async function run() {
    if (destructive && !confirm(`Run "${cmd}"? This is potentially destructive.`)) return;
    setLoading(true); setResult(null);
    try {
      const cleanup = subscribeSSE(`/api/sites/${slug}/shortcut`, {
        done:  (d) => { setResult({ ok: d.code === 0 }); cleanup(); setLoading(false); },
        error: (d) => { setResult({ ok: false, msg: d.message }); cleanup(); setLoading(false); },
      });
      await api.post(`/api/sites/${slug}/shortcut`, { cmd });
    } catch (e) {
      setResult({ ok: false, msg: e.message });
      setLoading(false);
    }
  }

  return (
    <Button
      size="sm"
      variant={destructive ? 'destructive' : 'outline'}
      loading={loading}
      onClick={run}
      title={cmd}
    >
      {result !== null && (result.ok ? <CheckCircle className="h-3 w-3 text-green-500" /> : <AlertCircle className="h-3 w-3" />)}
      {label}
    </Button>
  );
}
