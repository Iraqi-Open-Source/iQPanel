import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, postSSE, sseMessage } from '../lib/api.js';
import ReauthDialog from '../components/ReauthDialog.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import { Dialog, DialogContent, DialogDescription } from '../components/ui/Dialog.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import Input from '../components/ui/Input.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import { formatBytes, timeAgo } from '../lib/utils.js';
import SiteAccessFields, {
  accessPayload, installedPhpVersions, validateAccess,
} from '../components/SiteAccessFields.jsx';
import DeployRecipeEditor, { normalizeRecipeSteps, toApiSteps } from '../components/DeployRecipeEditor.jsx';
import {
  Play, RefreshCw, ArrowLeft, Copy, FileText,
  Database, Clock, Shield, Archive, Globe, AlertCircle,
  CheckCircle, ChevronRight, Settings, RotateCcw,
  FilePlus, Folder, File,
} from 'lucide-react';
import { CreatedCredsBanner, DbPasswordButton, HealthBadge } from './DatabasesPage.jsx';

const TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'settings',    label: 'PHP & Domain' },
  { id: 'commands',    label: 'Commands' },
  { id: 'env',         label: 'Environment' },
  { id: 'deployments', label: 'Deployments' },
  { id: 'databases',   label: 'Databases' },
  { id: 'files',       label: 'Files' },
  { id: 'queues',      label: 'Queues & Scheduler' },
  { id: 'cron',        label: 'Cron' },
  { id: 'logs',        label: 'Logs' },
  { id: 'ssl',         label: 'SSL' },
];

const SHORTCUTS = [
  { label: 'about', cmd: 'php artisan about' },
  { label: 'migrate:status',    cmd: 'php artisan migrate:status' },
  { label: 'migrate',           cmd: 'php artisan migrate' },
  { label: 'db:seed',           cmd: 'php artisan db:seed' },
  { label: 'optimize',          cmd: 'php artisan optimize' },
  { label: 'optimize:clear',    cmd: 'php artisan optimize:clear' },
  { label: 'Config cache',      cmd: 'php artisan config:cache' },
  { label: 'Route cache',       cmd: 'php artisan route:cache' },
  { label: 'View cache',        cmd: 'php artisan view:cache' },
  { label: 'Cache clear',       cmd: 'php artisan cache:clear' },
  { label: 'Storage link',      cmd: 'php artisan storage:link' },
  { label: 'Queue restart',     cmd: 'php artisan queue:restart' },
  { label: 'up',                cmd: 'php artisan up' },
  { label: 'down',              cmd: 'php artisan down' },
  { label: 'Composer install',  cmd: 'composer install --no-dev --optimize-autoloader --no-interaction' },
  { label: 'npm build',         cmd: 'npm run build' },
  { label: 'Migrate fresh ⚠',   cmd: 'php artisan migrate:fresh', destructive: true },
  { label: 'Migrate rollback ⚠', cmd: 'php artisan migrate:rollback', destructive: true },
];

const CRON_PRESETS = [
  {
    group: 'Minutes',
    items: [
      { label: 'Every minute',      value: '* * * * *' },
      { label: 'Every 2 minutes',   value: '*/2 * * * *' },
      { label: 'Every 5 minutes',   value: '*/5 * * * *' },
      { label: 'Every 10 minutes',  value: '*/10 * * * *' },
      { label: 'Every 15 minutes',  value: '*/15 * * * *' },
      { label: 'Every 30 minutes',  value: '*/30 * * * *' },
    ],
  },
  {
    group: 'Hours',
    items: [
      { label: 'Hourly',                         value: '0 * * * *' },
      { label: 'Every 2 hours',                  value: '0 */2 * * *' },
      { label: 'Every 6 hours',                  value: '0 */6 * * *' },
      { label: 'Every 12 hours (half day)',      value: '0 */12 * * *' },
    ],
  },
  {
    group: 'Days',
    items: [
      { label: 'Daily (midnight)',               value: '0 0 * * *' },
      { label: 'Weekly (Sunday midnight)',       value: '0 0 * * 0' },
      { label: 'Monthly (1st, midnight)',        value: '0 0 1 * *' },
    ],
  },
];

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function SiteDetailPage() {
  const { slug, tab = 'overview' } = useParams();
  const navigate    = useNavigate();
  const qc          = useQueryClient();
  const [activeTab, setActiveTab] = useState(tab === 'terminal' ? 'overview' : tab);
  const [deployOpen, setDeployOpen] = useState(false);
  const [recipeSteps, setRecipeSteps] = useState([]);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState('');

  const { data: site, isLoading } = useQuery({
    queryKey: ['site', slug],
    queryFn: () => api.get(`/api/sites/${slug}`),
  });

  useEffect(() => {
    if (tab === 'terminal') {
      navigate(`/sites/${slug}/overview`, { replace: true });
      setActiveTab('overview');
      return;
    }
    setActiveTab(tab);
  }, [tab, slug, navigate]);

  async function openDeployDialog() {
    setDeployOpen(true);
    setDeployError('');
    setRecipeLoading(true);
    try {
      const steps = await api.get(`/api/sites/${slug}/wizard/steps`);
      setRecipeSteps(normalizeRecipeSteps(Array.isArray(steps) ? steps : []));
    } catch (e) {
      setDeployError(e.message);
      setRecipeSteps([]);
    } finally {
      setRecipeLoading(false);
    }
  }

  async function confirmDeploy() {
    setDeploying(true);
    setDeployError('');
    try {
      await api.put(`/api/sites/${slug}/wizard/steps`, { steps: toApiSteps(recipeSteps) });
      await api.post(`/api/sites/${slug}/deploy`, {});
      qc.invalidateQueries(['site', slug]);
      qc.invalidateQueries(['deployments', slug]);
      setDeployOpen(false);
      navigate(`/sites/${slug}/deployments`);
    } catch (e) {
      setDeployError(e.message);
    } finally {
      setDeploying(false);
    }
  }

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
          <Button size="sm" variant="outline" asChild>
            <Link to={`/sites/${slug}/settings`}>
              <Settings className="h-3 w-3" /> PHP & Domain
            </Link>
          </Button>
          <Button size="sm" onClick={openDeployDialog}>
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
      {activeTab === 'settings'    && <SettingsTab    site={site} />}
      {activeTab === 'commands'    && <CommandsTab    site={site} />}
      {activeTab === 'env'         && <EnvTab         site={site} />}
      {activeTab === 'deployments' && <DeploymentsTab site={site} />}
      {activeTab === 'databases'   && <DatabasesTab   site={site} />}
      {activeTab === 'files'       && <FilesTab       site={site} />}
      {activeTab === 'queues'      && <QueuesTab       site={site} />}
      {activeTab === 'cron'        && <CronTab        site={site} />}
      {activeTab === 'logs'        && <LogsTab        site={site} />}
      {activeTab === 'ssl'         && <SSLTab         site={site} />}

      <Dialog open={deployOpen} onOpenChange={(open) => { if (!deploying) setDeployOpen(open); }}>
        <DialogContent title="Post-pull commands" className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogDescription className="text-sm text-muted-foreground">
            Review the commands that run after git pull. Add, edit, reorder, or remove them, then deploy.
          </DialogDescription>
          <div className="max-h-[55vh] overflow-y-auto pr-1">
            {recipeLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
              <DeployRecipeEditor steps={recipeSteps} onChange={setRecipeSteps} />
            )}
          </div>
          {deployError && <p className="text-sm text-destructive" role="alert">{deployError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeployOpen(false)} disabled={deploying}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmDeploy} loading={deploying} disabled={recipeLoading}>
              <RefreshCw className="h-3 w-3" /> Save and deploy
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Site Info</CardTitle>
          <Link to={`/sites/${site.slug}/settings`} className="text-sm font-medium text-primary hover:underline">
            Change PHP, domain, or port
          </Link>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row
            label="Domain/Port"
            value={site.domain ?? (site.port ? `Port ${site.port}` : '—')}
            editTo={`/sites/${site.slug}/settings`}
          />
          <Row
            label="PHP version"
            value={`PHP ${site.php_version}`}
            editTo={`/sites/${site.slug}/settings`}
          />
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
      <PathsCard site={site} className="sm:col-span-2" />
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
/* Settings                                         */
/* ──────────────────────────────────────────────── */
function SettingsTab({ site }) {
  const qc = useQueryClient();
  const showPhp = site.type === 'laravel' || site.type === 'php';
  const { data: installed = {} } = useQuery({
    queryKey: ['php-versions'],
    queryFn: () => api.get('/api/php/versions'),
  });
  const phpOptions = installedPhpVersions(installed, site.php_version);

  const [phpVersion, setPhpVersion] = useState(site.php_version);
  const [usePort, setUsePort] = useState(!site.domain);
  const [domain, setDomain] = useState(site.domain ?? '');
  const [listenPort, setListenPort] = useState(site.port != null ? String(site.port) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPhpVersion(site.php_version);
    setUsePort(!site.domain);
    setDomain(site.domain ?? '');
    setListenPort(site.port != null ? String(site.port) : '');
  }, [site.id, site.php_version, site.domain, site.port]);

  const domainChanging = Boolean(site.ssl_status === 'active' && site.domain && (
    usePort || String(domain).trim() !== site.domain
  ));

  async function save() {
    const accessError = validateAccess({ usePort, domain, port: listenPort });
    if (accessError) { setError(accessError); return; }
    if (showPhp && !phpOptions.length) { setError('Install a PHP version first'); return; }
    setSaving(true); setError(''); setSaved(false);
    try {
      await api.patch(`/api/sites/${site.slug}`, accessPayload({
        phpVersion, usePort, domain, port: listenPort,
      }));
      qc.invalidateQueries(['site', site.slug]);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-base">Change PHP, domain, or port</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">Edit how this site is reached and which PHP it runs.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <SiteAccessFields
          phpVersion={phpVersion}
          onPhpVersion={setPhpVersion}
          phpOptions={phpOptions}
          showPhp={showPhp}
          showAccess
          usePort={usePort}
          onUsePort={setUsePort}
          domain={domain}
          onDomain={setDomain}
          port={listenPort}
          onPort={setListenPort}
          sslWarning={domainChanging}
        />
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {saved && !error && <p className="text-sm text-green-600">Settings saved. Nginx and PHP-FPM were updated.</p>}
        <Button onClick={save} loading={saving}>Save</Button>
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────────── */
/* Commands                                         */
/* ──────────────────────────────────────────────── */
function CommandsTab({ site }) {
  const [cmd, setCmd]       = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const pendingCmd = useRef(null);
  const outputRef = useRef(null);

  async function runCmd(command) {
    if (!command) return;
    setOutput(`$ ${command}\n`);
    setRunning(true);
    try {
      await runSiteCommand(site.slug, command, {
        stdout: (d) => setOutput((o) => o + (d.line ?? '')),
        stderr: (d) => setOutput((o) => o + (d.line ?? '')),
        done:   (d) => setOutput((o) => o + `\n[exit ${d.code ?? 0}]\n`),
        error:  (d) => setOutput((o) => o + `\nError: ${sseMessage(d)}\n`),
      });
    } catch (e) {
      if (isReauthError(e)) {
        pendingCmd.current = command;
        setReauthOpen(true);
        setOutput((o) => o + '\nRe-authentication required. Confirm your password to continue.\n');
      } else {
        setOutput((o) => o + `\nError: ${e.message}\n`);
      }
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);

  return (
    <div className="space-y-4">
      {site.type === 'laravel' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Quick shortcuts</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {SHORTCUTS.map(({ label, cmd: c, destructive }) => (
                <ShortcutButton
                  key={c}
                  slug={site.slug}
                  cmd={c}
                  label={label}
                  destructive={destructive}
                  onRun={() => runCmd(c)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
      <ReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        onSuccess={() => { const c = pendingCmd.current; pendingCmd.current = null; if (c) runCmd(c); }}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────── */
/* Environment Editor                               */
/* ──────────────────────────────────────────────── */
function EnvTab({ site }) {
  const [draft, setDraft]     = useState(undefined);
  const [saved, setSaved]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [reauthOpen, setReauthOpen] = useState(false);

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: ['env', site.slug],
    queryFn:  () => api.get(`/api/sites/${site.slug}/env`),
  });

  const content = draft !== undefined ? draft : (data?.content ?? '');
  const loaded  = !isLoading && !isError;

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.put(`/api/sites/${site.slug}/env`, { content });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      if (isReauthError(e)) setReauthOpen(true);
      else setError(e.message);
    } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">.env editor</CardTitle>
            {data?.path && <p className="mt-1 text-xs text-muted-foreground font-mono truncate">{data.path}</p>}
          </div>
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Saved</span>}
            <Button size="sm" onClick={save} loading={saving} disabled={!loaded}>Save</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex h-[500px] items-center justify-center rounded-md border border-input bg-muted/40">
            <Spinner />
          </div>
        )}
        {isError && (
          <p className="text-sm text-destructive">{loadError?.message ?? 'Failed to load .env'}</p>
        )}
        {loaded && (
          <textarea
            className="w-full rounded-md border border-input bg-zinc-950 text-emerald-300 font-mono text-xs leading-5 p-3 h-[500px] resize-y focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-zinc-500"
            style={{ colorScheme: 'dark' }}
            value={content}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            placeholder={'APP_NAME=\nAPP_ENV=production\nAPP_KEY='}
            aria-label=".env file contents"
          />
        )}
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <p className="mt-2 text-xs text-muted-foreground">Changes are written to disk on save. Run <code>php artisan config:clear</code> after editing.</p>
      </CardContent>
      <ReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        onSuccess={save}
      />
    </Card>
  );
}

/* ──────────────────────────────────────────────── */
/* Deployments                                      */
/* ──────────────────────────────────────────────── */
function DeploymentsTab({ site }) {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState(null);
  const autoOpened = useRef(false);

  const { data: deploys = [] } = useQuery({
    queryKey: ['deployments', site.slug],
    queryFn:  () => api.get(`/api/sites/${site.slug}/deployments`),
    refetchInterval: (q) => {
      const rows = q.state.data ?? [];
      return rows.some((d) => d.status === 'queued' || d.status === 'running') ? 1500 : 8000;
    },
  });

  useEffect(() => {
    if (autoOpened.current) return;
    const live = deploys.find((d) => d.status === 'running' || d.status === 'queued')
      ?? deploys.find((d) => d.status === 'failed');
    if (live) { setOpenId(live.id); autoOpened.current = true; }
  }, [deploys]);

  const { data: detail } = useQuery({
    queryKey: ['deployment-steps', openId],
    queryFn:  () => api.get(`/api/deployments/${openId}/steps`),
    enabled:  Boolean(openId),
    refetchInterval: () => {
      const d = deploys.find((x) => x.id === openId);
      return d && (d.status === 'running' || d.status === 'queued') ? 800 : false;
    },
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
            {deploys.map((d) => {
              const open = openId === d.id;
              const steps = open && detail?.id === d.id ? detail.steps : (d.steps ?? []);
              return (
                <div key={d.id} className="py-3">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : d.id)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <div className="text-sm space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
                        <Badge variant={d.status === 'success' ? 'success' : d.status === 'failed' ? 'destructive' : 'warning'}>{d.status}</Badge>
                        <code className="text-xs">{d.commit_sha?.slice(0, 8) ?? '—'}</code>
                        <span className="text-muted-foreground text-xs truncate">{d.commit_msg?.slice(0, 60)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground pl-6">{d.triggered_by} · {timeAgo(d.created_at)}</p>
                    </div>
                    {d.status === 'success' && d.commit_sha && (
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); rollback(d.id); }}>
                        <RotateCcw className="h-3 w-3" /> Rollback
                      </Button>
                    )}
                  </button>
                  {open && (
                    <div className="mt-3 ml-6 space-y-2">
                      {steps.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Waiting for steps…</p>
                      ) : steps.map((s) => (
                        <DeployStep key={s.id ?? s.position} step={s} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function stepBadge(status) {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'destructive';
  if (status === 'running') return 'warning';
  return 'secondary';
}

function DeployStep({ step }) {
  const [showOut, setShowOut] = useState(step.status === 'failed' || step.status === 'running');
  useEffect(() => {
    if (step.status === 'failed' || step.status === 'running') setShowOut(true);
  }, [step.status]);

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setShowOut((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {step.status === 'running'
          ? <Spinner size="sm" />
          : step.status === 'success'
            ? <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" />
            : step.status === 'failed'
              ? <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
              : <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <span className="text-sm font-medium truncate flex-1">{step.name || step.cmd}</span>
        <Badge variant={stepBadge(step.status)}>{step.status}</Badge>
      </button>
      {showOut && (
        <pre className="max-h-72 overflow-auto border-t border-border bg-gray-950 p-3 text-xs font-mono text-green-400 whitespace-pre-wrap">
          {step.cmd ? `$ ${step.cmd}\n` : ''}{step.output || (step.status === 'skipped' ? '(skipped — first deploy only)\n' : '(no output yet)\n')}
        </pre>
      )}
    </div>
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
  const [form, setForm] = useState(null);
  const [engine, setEngine] = useState('mysql');
  const [dbName, setDbName] = useState('');
  const [dbUser, setDbUser] = useState('');
  const [dbPass, setDbPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdCreds, setCreatedCreds] = useState(null);
  const [envError, setEnvError] = useState('');
  const [dbHealth, setDbHealth] = useState({});
  const qc = useQueryClient();

  const { data: existing = [], isFetching: loadingExisting } = useQuery({
    queryKey: ['db-existing', engine],
    queryFn:  () => api.get(`/api/databases/existing?engine=${encodeURIComponent(engine)}`),
    enabled: form === 'import' && ready.includes(engine),
  });

  function resetFields() {
    setDbName('');
    setDbUser('');
    setDbPass('');
  }

  function openForm(mode) {
    const first = ready.includes(engine) ? engine : (ready[0] ?? 'mysql');
    setEngine(first);
    resetFields();
    setForm(form === mode ? null : mode);
  }

  async function create() {
    setLoading(true);
    try {
      const body = { site_slug: site.slug, engine, db_name: dbName, inject_env: true };
      if (dbUser.trim()) body.db_user = dbUser.trim();
      if (dbPass) body.db_pass = dbPass;
      const r = await api.post('/api/databases', body);
      qc.invalidateQueries(['site-dbs', site.slug]);
      qc.invalidateQueries(['databases']);
      qc.invalidateQueries(['db-existing']);
      setCreatedCreds({ db_name: r.db_name, db_user: r.db_user, db_pass: r.db_pass });
      setEnvError(r.env_error || '');
      setForm(null);
      resetFields();
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }

  async function importExisting() {
    setLoading(true);
    try {
      const body = { site_slug: site.slug, engine, db_name: dbName, db_user: dbUser || dbName };
      if (dbPass) body.db_pass = dbPass;
      await api.post('/api/databases/import', body);
      qc.invalidateQueries(['site-dbs', site.slug]);
      qc.invalidateQueries(['databases']);
      qc.invalidateQueries(['db-existing']);
      setForm(null);
      resetFields();
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
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

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Databases</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => openForm('import')}>
              {form === 'import' ? 'Cancel' : 'Add existing'}
            </Button>
            <Button size="sm" onClick={() => openForm('create')}>
              {form === 'create' ? 'Cancel' : '+ New database'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <CreatedCredsBanner
          creds={createdCreds}
          envError={envError}
          onDismiss={() => { setCreatedCreds(null); setEnvError(''); }}
        />
        {form === 'create' && (
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="site-create-engine" className="text-xs font-medium">Engine</label>
                <select id="site-create-engine" className="h-8 w-full rounded border border-input bg-transparent text-sm px-2" value={engine} onChange={(e) => setEngine(e.target.value)}>
                  {ready.length === 0 && <option value="">No engine running</option>}
                  {ready.includes('mysql') && <option value="mysql">MySQL</option>}
                  {ready.includes('mariadb') && <option value="mariadb">MariaDB</option>}
                  {ready.includes('postgres') && <option value="postgres">PostgreSQL</option>}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="site-create-name" className="text-xs font-medium">Database name</label>
                <Input id="site-create-name" className="h-8 text-xs" value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder="myapp_db" />
              </div>
              <div className="space-y-1">
                <label htmlFor="site-create-user" className="text-xs font-medium">Username</label>
                <Input id="site-create-user" className="h-8 text-xs" value={dbUser} onChange={(e) => setDbUser(e.target.value)} placeholder="defaults to database name" />
              </div>
              <div className="space-y-1">
                <label htmlFor="site-create-pass" className="text-xs font-medium">Password</label>
                <Input id="site-create-pass" className="h-8 text-xs" type="password" value={dbPass} onChange={(e) => setDbPass(e.target.value)} placeholder="auto-generated" autoComplete="new-password" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Leave user and password empty to use Plesk-style defaults. Credentials are injected into .env.</p>
            <Button size="sm" onClick={create} loading={loading} disabled={!engine || !dbName}>Create database</Button>
          </div>
        )}
        {form === 'import' && (
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="site-import-engine" className="text-xs font-medium">Engine</label>
                <select id="site-import-engine" className="h-8 w-full rounded border border-input bg-transparent text-sm px-2" value={engine} onChange={(e) => { setEngine(e.target.value); setDbName(''); }}>
                  {ready.length === 0 && <option value="">No engine running</option>}
                  {ready.includes('mysql') && <option value="mysql">MySQL</option>}
                  {ready.includes('mariadb') && <option value="mariadb">MariaDB</option>}
                  {ready.includes('postgres') && <option value="postgres">PostgreSQL</option>}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="site-import-name" className="text-xs font-medium">Existing database</label>
                <select
                  id="site-import-name"
                  className="h-8 w-full rounded border border-input bg-transparent text-sm px-2"
                  value={dbName}
                  onChange={(e) => { setDbName(e.target.value); if (!dbUser) setDbUser(e.target.value); }}
                  disabled={loadingExisting || ready.length === 0}
                >
                  <option value="">{loadingExisting ? 'Loading…' : existing.length ? 'Select…' : 'No untracked databases'}</option>
                  {existing.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="site-import-user" className="text-xs font-medium">Username</label>
                <Input id="site-import-user" className="h-8 text-xs" value={dbUser} onChange={(e) => setDbUser(e.target.value)} placeholder="existing_user" />
              </div>
              <div className="space-y-1">
                <label htmlFor="site-import-pass" className="text-xs font-medium">Password</label>
                <Input id="site-import-pass" className="h-8 text-xs" type="password" value={dbPass} onChange={(e) => setDbPass(e.target.value)} placeholder="optional, for health checks" autoComplete="new-password" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Attaches an existing server database to {site.name} without creating it again.</p>
            <Button size="sm" onClick={importExisting} loading={loading} disabled={!engine || !dbName}>Add to site</Button>
          </div>
        )}
        {dbs.length === 0 ? <p className="text-sm text-muted-foreground">No databases yet.</p> : (
          <div className="divide-y divide-border">
            {dbs.map((db) => (
              <div key={db.id} className="py-2 text-sm flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{db.db_name}</span>
                  <span className="ml-2 text-muted-foreground text-xs">{db.engine} · {db.db_user}</span>
                  <DbPasswordButton
                    id={db.id}
                    knownPassword={createdCreds?.db_name === db.db_name ? createdCreds.db_pass : undefined}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={db.granted ? 'success' : 'warning'}>{db.granted ? 'Granted' : 'Pending'}</Badge>
                  <HealthBadge result={dbHealth[db.id]} />
                  <Button size="sm" variant="outline" loading={dbHealth[db.id]?.loading} onClick={() => testDbHealth(db.id)}>
                    Healthy
                  </Button>
                </div>
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
  const [saved, setSaved] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [fileName, setFileName] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [dialogLoading, setDialogLoading] = useState(false);
  const qc = useQueryClient();

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['files', site.slug, path],
    queryFn:  () => api.get(`/api/sites/${site.slug}/files?path=${encodeURIComponent(path)}`),
  });

  function goTo(next) {
    setPath(next);
    setSelected(null);
    setFileContent('');
    setSaved(false);
  }

  async function writeFile(rel, content) {
    await api.put(`/api/sites/${site.slug}/files`, { path: rel, content });
    qc.invalidateQueries(['files', site.slug]);
  }

  function selectRel(rel, content) {
    setSelected({ name: baseName(rel), isDir: false, rel });
    setFileContent(content);
    const dir = parentDir(rel);
    if (dir !== path) setPath(dir);
  }

  async function openFile(entry) {
    if (entry.isDir) { goTo(joinRelPath(path, entry.name)); return; }
    const rel = joinRelPath(path, entry.name);
    try {
      const result = await api.get(`/api/sites/${site.slug}/files/read?path=${encodeURIComponent(rel)}`);
      selectRel(rel, result.content ?? '');
      setSaved(false);
    } catch (e) { alert(e.message); }
  }

  async function save() {
    if (!selected?.rel) return;
    setSaving(true);
    try {
      await writeFile(selected.rel, fileContent);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  }

  function openCreate() {
    setFileName('');
    setDialogError('');
    setDialog('create');
  }

  function openSaveAs() {
    setFileName(selected?.name ?? '');
    setDialogError('');
    setDialog('saveas');
  }

  async function submitDialog(e) {
    e.preventDefault();
    let rel;
    try { rel = joinRelPath(path, fileName); }
    catch (err) { setDialogError(err.message); return; }
    if (dialog === 'create' && parentDir(rel) === path && entries.some((e) => !e.isDir && e.name === baseName(rel))) {
      setDialogError('A file with that name already exists');
      return;
    }
    if (dialog === 'saveas' && rel !== selected?.rel && parentDir(rel) === path && entries.some((e) => !e.isDir && e.name === baseName(rel))) {
      if (!confirm(`Overwrite ${baseName(rel)}?`)) return;
    }
    setDialogLoading(true);
    setDialogError('');
    try {
      const content = dialog === 'create' ? '' : fileContent;
      await writeFile(rel, content);
      setDialog(null);
      selectRel(rel, content);
      if (dialog === 'saveas') {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      setDialogError(err.message);
    } finally {
      setDialogLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 h-[600px]">
      <Card className="overflow-auto">
        <CardHeader className="p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0 overflow-x-auto">
              <button type="button" onClick={() => goTo('.')} className="hover:text-foreground">root</button>
              {path !== '.' && path.split('/').map((seg, i, arr) => (
                <React.Fragment key={i}>
                  <ChevronRight className="h-3 w-3 shrink-0" />
                  <button type="button" onClick={() => goTo(arr.slice(0, i + 1).join('/'))} className="hover:text-foreground truncate">{seg}</button>
                </React.Fragment>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={openCreate}>
              <FilePlus className="h-3 w-3" /> New file
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : entries.length === 0 ? (
            <p className="px-3 py-6 text-sm text-muted-foreground">This folder is empty.</p>
          ) : entries.map((e) => (
            <button
              key={e.name}
              type="button"
              onClick={() => openFile(e)}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2 ${selected?.name === e.name && !e.isDir ? 'bg-accent' : ''}`}
            >
              {e.isDir
                ? <Folder className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                : <File className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="flex-1 truncate">{e.name}</span>
              {!e.isDir && <span className="text-xs text-muted-foreground">{formatBytes(e.size)}</span>}
            </button>
          ))}
        </CardContent>
      </Card>
      <Card className="md:col-span-2 flex flex-col overflow-hidden">
        {selected ? (
          <>
            <CardHeader className="p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate font-mono">{selected.rel || selected.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {saved && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Saved</span>}
                  <Button size="sm" variant="outline" onClick={openSaveAs}>Save as</Button>
                  <Button size="sm" onClick={save} loading={saving}>Save</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 p-0 min-h-0">
              <textarea
                className="w-full h-full min-h-[420px] bg-zinc-950 text-emerald-300 font-mono text-xs leading-5 p-3 resize-none focus:outline-none"
                style={{ colorScheme: 'dark' }}
                value={fileContent}
                onChange={(e) => { setFileContent(e.target.value); setSaved(false); }}
                spellCheck={false}
                aria-label={`Edit ${selected.name}`}
              />
            </CardContent>
          </>
        ) : (
          <CardContent className="flex flex-col items-center justify-center h-full gap-3 text-sm text-muted-foreground">
            <p>Select a file to edit, or create a new one.</p>
            <Button size="sm" variant="outline" onClick={openCreate}>
              <FilePlus className="h-3 w-3" /> New file
            </Button>
          </CardContent>
        )}
      </Card>
      <FileNameDialog
        open={dialog !== null}
        title={dialog === 'saveas' ? 'Save as' : 'Create file'}
        description={dialog === 'saveas'
          ? 'Save a copy under a new name in this folder.'
          : `Create a file in ${path === '.' ? 'the app root' : path}.`}
        label="File name"
        value={fileName}
        onChange={setFileName}
        error={dialogError}
        loading={dialogLoading}
        submitLabel={dialog === 'saveas' ? 'Save as' : 'Create'}
        onClose={() => setDialog(null)}
        onSubmit={submitDialog}
      />
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
  const [preset, setPreset]         = useState('');
  const [customSchedule, setCustomSchedule] = useState('');
  const [cmd, setCmd]               = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  const schedule = preset === 'custom' ? customSchedule.trim() : preset;

  async function add() {
    if (!schedule) { setError('Choose a schedule'); return; }
    if (!cmd.trim()) { setError('Enter a command'); return; }
    setLoading(true);
    setError('');
    try {
      await api.post('/api/cron', { site_slug: site.slug, schedule, command: cmd.trim() });
      qc.invalidateQueries(['site-cron', site.slug]);
      setCmd('');
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Cron Jobs</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="cron-schedule" className="text-xs font-medium">Schedule</label>
              <select
                id="cron-schedule"
                className={SELECT_CLASS}
                value={preset}
                onChange={(e) => { setPreset(e.target.value); setError(''); }}
              >
                <option value="">Choose schedule…</option>
                {CRON_PRESETS.map((group) => (
                  <optgroup key={group.group} label={group.group}>
                    {group.items.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </optgroup>
                ))}
                <option value="custom">Custom…</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="cron-cmd" className="text-xs font-medium">Command</label>
              <Input
                id="cron-cmd"
                className="font-mono text-xs"
                placeholder="php artisan schedule:run"
                value={cmd}
                onChange={(e) => { setCmd(e.target.value); setError(''); }}
              />
            </div>
            {preset === 'custom' && (
              <div className="space-y-1 sm:col-span-2">
                <label htmlFor="cron-custom" className="text-xs font-medium">Cron expression</label>
                <Input
                  id="cron-custom"
                  className="font-mono text-xs"
                  placeholder="* * * * *"
                  value={customSchedule}
                  onChange={(e) => { setCustomSchedule(e.target.value); setError(''); }}
                  aria-describedby="cron-custom-hint"
                />
                <p id="cron-custom-hint" className="text-xs text-muted-foreground">Five fields: minute hour day-of-month month day-of-week.</p>
              </div>
            )}
          </div>
          {schedule && preset !== 'custom' && (
            <p className="text-xs text-muted-foreground">Expression: <code>{schedule}</code></p>
          )}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button size="sm" onClick={add} loading={loading} disabled={!schedule || !cmd.trim()}>Add</Button>
          {jobs.length === 0 ? <p className="text-sm text-muted-foreground">No cron jobs.</p> : (
            <div className="divide-y divide-border">
              {jobs.map((j) => (
                <div key={j.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <code className="text-xs mr-2">{j.schedule}</code>
                    <span className="break-all">{j.command}</span>
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
      <PathsCard site={site} />
    </div>
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
    try {
      await postSSE(`/api/sites/${site.slug}/ssl/issue`, { email }, {
        stdout: (d) => setOutput((o) => o + (d.line ?? '')),
        stderr: (d) => setOutput((o) => o + (d.line ?? '')),
        done:   () => { qc.invalidateQueries(['site', site.slug]); },
        error:  (d) => setOutput((o) => o + `Error: ${sseMessage(d)}`),
      });
    } catch (e) {
      setOutput((o) => o + `Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">SSL Certificate</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {!site.domain ? (
          <p className="text-sm text-muted-foreground">
            Set a domain on the{' '}
            <Link to={`/sites/${site.slug}/settings`} className="text-primary hover:underline">PHP & Domain</Link>
            {' '}tab to issue an SSL certificate.
          </p>
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
/* Shared helpers                                   */
/* ──────────────────────────────────────────────── */
function sitePathRows(site) {
  return [
    { label: 'App root',    value: site.directory ? `${site.directory}/app` : '—' },
    { label: 'Site user',   value: site.run_as_user || '—' },
    { label: 'Deploy key',  value: site.deploy_key_pub ? site.deploy_key_pub.slice(0, 50) + '…' : '—' },
    { label: 'Nginx vhost', value: `/etc/nginx/sites-available/${site.slug}.conf` },
    { label: 'PHP pool',    value: `/etc/php/${site.php_version}/fpm/pool.d/${site.slug}.conf` },
  ];
}

function PathsCard({ site, className }) {
  function copy(t) { navigator.clipboard.writeText(t); }
  return (
    <Card className={className}>
      <CardHeader><CardTitle className="text-base">Paths</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {sitePathRows(site).map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
            <code className="text-xs flex-1 truncate">{value}</code>
            <button type="button" onClick={() => copy(value)} className="text-muted-foreground hover:text-foreground" aria-label={`Copy ${label}`}>
              <Copy className="h-3 w-3" />
            </button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function sanitizeRelPath(name) {
  const n = String(name ?? '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!n) throw new Error('Enter a file name');
  const parts = n.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) throw new Error('Invalid file name');
  return n;
}

function joinRelPath(dir, name) {
  const n = sanitizeRelPath(name);
  if (!dir || dir === '.') return n;
  return `${String(dir).replace(/\/+$/, '')}/${n}`;
}

function parentDir(rel) {
  const i = String(rel).lastIndexOf('/');
  return i === -1 ? '.' : rel.slice(0, i);
}

function baseName(rel) {
  const i = String(rel).lastIndexOf('/');
  return i === -1 ? rel : rel.slice(i + 1);
}

function FileNameDialog({ open, title, description, label, value, onChange, error, loading, submitLabel, onClose, onSubmit }) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent title={title}>
        <DialogDescription className="text-sm text-muted-foreground">{description}</DialogDescription>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="file-name-dialog" className="text-xs font-medium">{label}</label>
            <Input
              id="file-name-dialog"
              autoFocus
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="example.php"
            />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading} disabled={!String(value).trim()}>{submitLabel}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, editTo }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 font-medium">
        <span>{value}</span>
        {editTo ? (
          <Link to={editTo} className="text-xs font-medium text-primary hover:underline">Change</Link>
        ) : null}
      </span>
    </div>
  );
}

function isReauthError(e) {
  return e?.code === 'reauth' || e?.data?.code === 'reauth';
}

const SHORTCUT_CMDS = new Set(SHORTCUTS.map((s) => s.cmd));

async function runSiteCommand(slug, command, handlers) {
  const cmd = String(command ?? '').trim();
  const url = SHORTCUT_CMDS.has(cmd)
    ? `/api/sites/${slug}/shortcut`
    : `/api/sites/${slug}/exec`;
  await postSSE(url, { cmd }, handlers);
}

function ShortcutButton({ slug, cmd, label, destructive, onRun }) {
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [reauthOpen, setReauthOpen] = useState(false);

  async function run() {
    if (destructive && !confirm(`Run "${cmd}"? This is potentially destructive.`)) return;
    if (onRun) {
      setLoading(true);
      try { await onRun(); } finally { setLoading(false); }
      return;
    }
    setLoading(true); setResult(null);
    try {
      let exitCode = 0;
      await runSiteCommand(slug, cmd, {
        done:  (d) => { exitCode = d.code ?? 0; },
        error: (d) => { setResult({ ok: false, msg: sseMessage(d) }); },
      });
      setResult((prev) => prev ?? { ok: exitCode === 0 });
    } catch (e) {
      if (isReauthError(e)) {
        setReauthOpen(true);
        setResult({ ok: false, msg: 'Re-authentication required' });
      } else {
        setResult({ ok: false, msg: e.message });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant={destructive ? 'destructive' : 'outline'}
        loading={loading}
        onClick={run}
        title={result?.msg ? `${cmd} — ${result.msg}` : cmd}
      >
        {result !== null && (result.ok ? <CheckCircle className="h-3 w-3 text-green-500" /> : <AlertCircle className="h-3 w-3" />)}
        {label}
      </Button>
      <ReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        onSuccess={run}
      />
    </>
  );
}
