import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import { CheckCircle, Copy, ExternalLink, ChevronRight, ChevronLeft, GripVertical, Plus, Trash2 } from 'lucide-react';

const STEPS = ['Type', 'Repository', 'Domain / Port', 'Deploy Key', 'Recipe'];

const DEFAULT_STEPS_LARAVEL = [
  { cmd: 'cp -n .env.example .env', first_only: 1, enabled: 1 },
  { cmd: 'composer install --no-dev --optimize-autoloader --no-interaction', first_only: 0, enabled: 1 },
  { cmd: 'php artisan key:generate', first_only: 1, enabled: 1 },
  { cmd: 'php artisan storage:link', first_only: 1, enabled: 1 },
  { cmd: 'php artisan migrate --force', first_only: 0, enabled: 1 },
  { cmd: 'npm ci && npm run build', first_only: 0, enabled: 0 },
  { cmd: 'php artisan optimize', first_only: 0, enabled: 1 },
  { cmd: 'php artisan queue:restart', first_only: 0, enabled: 1 },
];

function parseRepoName(url) {
  if (!url) return '';
  const m = url.match(/([^/]+?)(?:\.git)?$/);
  return m ? m[1] : '';
}

function githubDeepLink(url) {
  const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return m ? `https://github.com/${m[1]}/settings/keys/new` : null;
}

export default function SiteWizardPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');

  // Form state
  const [type,       setType]       = useState('laravel');
  const [repoUrl,    setRepoUrl]    = useState('');
  const [name,       setName]       = useState('');
  const [domain,     setDomain]     = useState('');
  const [usePort,    setUsePort]    = useState(false);
  const [phpVersion, setPhpVersion] = useState('8.3');
  const [deploySteps, setDeploySteps] = useState(DEFAULT_STEPS_LARAVEL);

  // Created site info
  const [site,      setSite]      = useState(null);
  const [deployKey, setDeployKey] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const handleRepoChange = (url) => {
    setRepoUrl(url);
    if (!name) setName(parseRepoName(url));
  };

  // Step 0: type
  // Step 1: repo + name
  // Step 2: domain/port
  // Step 3: deploy key
  // Step 4: recipe

  async function createSite() {
    setLoading(true); setError('');
    try {
      const s = await api.post('/api/sites', {
        name, type, repo_url: repoUrl,
        domain: usePort ? null : domain || null,
        php_version: phpVersion,
      });
      setSite(s);
    } catch (e) {
      setError(e.message);
      return false;
    } finally { setLoading(false); }
    return true;
  }

  async function fetchDeployKey() {
    setLoading(true); setError('');
    try {
      const k = await api.get(`/api/sites/${site.slug}/wizard/deploy-key`);
      setDeployKey(k);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function testConnection() {
    setLoading(true); setTestResult(null); setError('');
    try {
      const r = await api.post(`/api/sites/${site.slug}/wizard/test-connection`, {});
      setTestResult(r);
    } catch (e) {
      setTestResult({ reachable: false, error: e.message });
    } finally { setLoading(false); }
  }

  async function saveStepsAndDeploy() {
    setLoading(true); setError('');
    try {
      await api.put(`/api/sites/${site.slug}/wizard/steps`, { steps: deploySteps });
      await api.post(`/api/sites/${site.slug}/deploy`, {});
    } catch (e) { setError(e.message); setLoading(false); return; }
    navigate(`/sites/${site.slug}/deployments`);
  }

  async function goNext() {
    setError('');
    if (step === 1) {
      if (!name) { setError('Name required'); return; }
    }
    if (step === 2) {
      const ok = await createSite();
      if (!ok) return;
    }
    if (step === 3) {
      await fetchDeployKey();
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() { setStep((s) => Math.max(s - 1, 0)); }

  const progress = ((step) / (STEPS.length - 1)) * 100;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Create New Site</h1>

      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          {STEPS.map((s, i) => (
            <span key={s} className={i <= step ? 'font-semibold text-primary' : ''}>{s}</span>
          ))}
        </div>
        <div className="h-1.5 rounded-full bg-muted">
          <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Step {step + 1}: {STEPS[step]}</CardTitle></CardHeader>
        <CardContent className="space-y-4">

          {/* Step 0: Type */}
          {step === 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { value: 'laravel', label: 'Laravel', icon: '🔺', desc: 'Laravel + PHP-FPM + Nginx' },
                { value: 'php',     label: 'PHP',     icon: '🐘', desc: 'Generic PHP application' },
                { value: 'node',    label: 'Node.js', icon: '🟢', desc: 'Node.js reverse proxy' },
                { value: 'static',  label: 'Static',  icon: '📄', desc: 'HTML/CSS/JS files' },
                { value: 'docker',  label: 'Docker',  icon: '🐳', desc: 'Docker Compose stack' },
              ].map(({ value, label, icon, desc }) => (
                <button
                  key={value}
                  onClick={() => setType(value)}
                  className={`rounded-lg border p-4 text-left transition-colors hover:border-primary ${type === value ? 'border-primary bg-primary/5' : 'border-border'}`}
                >
                  <p className="text-2xl">{icon}</p>
                  <p className="font-semibold mt-1">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </button>
              ))}
            </div>
          )}

          {/* Step 1: Repo + Name */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Repository URL</label>
                <Input
                  placeholder="https://github.com/org/repo.git or git@github.com:org/repo.git"
                  value={repoUrl}
                  onChange={(e) => handleRepoChange(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">HTTPS or SSH format. Leave empty for manual file upload.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Project name</label>
                <Input placeholder="my-laravel-app" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">PHP Version</label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={phpVersion}
                  onChange={(e) => setPhpVersion(e.target.value)}
                >
                  {['7.4','8.0','8.1','8.2','8.3','8.4','8.5'].map((v) => (
                    <option key={v} value={v}>PHP {v}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Step 2: Domain / Port */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex gap-3">
                <button
                  onClick={() => setUsePort(false)}
                  className={`flex-1 rounded-lg border p-3 text-sm text-left transition-colors ${!usePort ? 'border-primary bg-primary/5' : 'border-border'}`}
                >
                  <p className="font-semibold">Domain</p>
                  <p className="text-xs text-muted-foreground">e.g. myapp.example.com</p>
                </button>
                <button
                  onClick={() => setUsePort(true)}
                  className={`flex-1 rounded-lg border p-3 text-sm text-left transition-colors ${usePort ? 'border-primary bg-primary/5' : 'border-border'}`}
                >
                  <p className="font-semibold">Auto port</p>
                  <p className="text-xs text-muted-foreground">Allocate 8000–8999</p>
                </button>
              </div>
              {!usePort && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Domain</label>
                  <Input placeholder="myapp.example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {usePort ? 'A free port in range 8000–8999 will be automatically assigned.' : 'Point your DNS A record to this server before issuing SSL.'}
              </p>
            </div>
          )}

          {/* Step 3: Deploy Key */}
          {step === 3 && (
            <div className="space-y-4">
              {!deployKey ? (
                <Button onClick={fetchDeployKey} loading={loading}>Generate deploy key</Button>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Ed25519 public key</label>
                      <button onClick={() => navigator.clipboard.writeText(deployKey.publicKey)} className="flex items-center gap-1 text-xs text-primary hover:underline">
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    </div>
                    <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all">{deployKey.publicKey}</pre>
                  </div>
                  {deployKey.deployKeySettingsUrl && (
                    <a href={deployKey.deployKeySettingsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                      Add to GitHub repository <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="sm" onClick={testConnection} loading={loading}>Test connection</Button>
                    {testResult && (
                      testResult.reachable
                        ? <span className="text-sm text-green-600 flex items-center gap-1"><CheckCircle className="h-4 w-4" /> Connected!</span>
                        : <span className="text-sm text-destructive">Failed: {testResult.error}</span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 4: Recipe */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Reorder, toggle, or edit the commands that run after each deploy. First-deploy-only steps only run on the initial clone.</p>
              <div className="space-y-2">
                {deploySteps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2">
                    <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 space-y-1">
                      <Input
                        className="h-7 font-mono text-xs"
                        value={s.cmd}
                        onChange={(e) => {
                          const next = [...deploySteps];
                          next[i] = { ...next[i], cmd: e.target.value };
                          setDeploySteps(next);
                        }}
                      />
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={Boolean(s.enabled)} onChange={(e) => {
                            const next = [...deploySteps]; next[i] = { ...next[i], enabled: e.target.checked ? 1 : 0 }; setDeploySteps(next);
                          }} />
                          Enabled
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={Boolean(s.first_only)} onChange={(e) => {
                            const next = [...deploySteps]; next[i] = { ...next[i], first_only: e.target.checked ? 1 : 0 }; setDeploySteps(next);
                          }} />
                          First deploy only
                        </label>
                      </div>
                    </div>
                    <button onClick={() => setDeploySteps(deploySteps.filter((_, j) => j !== i))} className="text-destructive hover:opacity-70">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setDeploySteps([...deploySteps, { cmd: '', first_only: 0, enabled: 1 }])}>
                  <Plus className="h-3 w-3" /> Add step
                </Button>
              </div>
            </div>
          )}

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          {/* Navigation */}
          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={goBack} disabled={step === 0}>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={goNext} loading={loading}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={saveStepsAndDeploy} loading={loading}>
                Deploy Site
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
