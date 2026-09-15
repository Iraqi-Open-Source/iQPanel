import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import SiteAccessFields, {
  accessPayload, installedPhpVersions, validateAccess,
} from '../components/SiteAccessFields.jsx';
import { CheckCircle, Copy, ExternalLink, ChevronRight, ChevronLeft } from 'lucide-react';
import DeployRecipeEditor, {
  DEFAULT_LARAVEL_RECIPE, normalizeRecipeSteps, toApiSteps,
} from '../components/DeployRecipeEditor.jsx';

const STEPS = ['Type', 'Repository', 'Domain / Port', 'Deploy Key', 'Recipe'];

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
  const [listenPort, setListenPort] = useState('');
  const [phpVersion, setPhpVersion] = useState('8.3');
  const [phpInstalled, setPhpInstalled] = useState({});
  const [deploySteps, setDeploySteps] = useState(() => normalizeRecipeSteps(DEFAULT_LARAVEL_RECIPE));

  const showPhp = type === 'laravel' || type === 'php';
  const phpOptions = installedPhpVersions(phpInstalled);

  useEffect(() => {
    api.get('/api/php/versions').then((installed) => {
      setPhpInstalled(installed ?? {});
      const versions = installedPhpVersions(installed ?? {});
      if (versions.length && !versions.includes(phpVersion)) setPhpVersion(versions.includes('8.3') ? '8.3' : versions[0]);
    }).catch(() => setPhpInstalled({}));
  }, []);

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
      const access = accessPayload({ phpVersion, usePort, domain, port: listenPort });
      const s = site
        ? await api.patch(`/api/sites/${site.slug}`, access)
        : await api.post('/api/sites', { name, type, repo_url: repoUrl, ...access });
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
      await api.put(`/api/sites/${site.slug}/wizard/steps`, { steps: toApiSteps(deploySteps) });
      await api.post(`/api/sites/${site.slug}/deploy`, {});
    } catch (e) { setError(e.message); setLoading(false); return; }
    navigate(`/sites/${site.slug}/deployments`);
  }

  async function goNext() {
    setError('');
    if (step === 1) {
      if (!name) { setError('Name required'); return; }
      if (showPhp && !phpOptions.length) { setError('Install a PHP version before creating this site'); return; }
    }
    if (step === 2) {
      const accessError = validateAccess({ usePort, domain, port: listenPort });
      if (accessError) { setError(accessError); return; }
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
              {showPhp && (
                <SiteAccessFields
                  phpVersion={phpVersion}
                  onPhpVersion={setPhpVersion}
                  phpOptions={phpOptions}
                  showPhp
                  showAccess={false}
                  usePort={usePort}
                  onUsePort={setUsePort}
                  domain={domain}
                  onDomain={setDomain}
                  port={listenPort}
                  onPort={setListenPort}
                />
              )}
            </div>
          )}

          {/* Step 2: Domain / Port */}
          {step === 2 && (
            <SiteAccessFields
              phpVersion={phpVersion}
              onPhpVersion={setPhpVersion}
              phpOptions={phpOptions}
              showPhp={false}
              usePort={usePort}
              onUsePort={setUsePort}
              domain={domain}
              onDomain={setDomain}
              port={listenPort}
              onPort={setListenPort}
            />
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
              <p className="text-sm text-muted-foreground">Reorder, toggle, or edit the commands that run after each deploy. First-deploy-only steps only run on the initial clone. Use the arrows or drag the handle to change order.</p>
              <DeployRecipeEditor steps={deploySteps} onChange={setDeploySteps} />
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
