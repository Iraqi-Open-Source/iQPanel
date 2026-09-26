import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth-context.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Badge from '../components/ui/Badge.jsx';

export default function SettingsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: settings = {} } = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/api/settings') });

  const [values, setValues] = useState({});
  const [saved, setSaved]   = useState(false);

  const update = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function save() {
    await api.put('/api/settings', { ...settings, ...values });
    setValues((v) => ({ ...v, cloudflare_api_token: '' }));
    qc.invalidateQueries(['settings']);
    qc.invalidateQueries(['cloudflare-zones']);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // TOTP setup
  const [totpQR, setTotpQR]   = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const { refresh } = useAuth();

  async function setupTotp() {
    const r = await api.post('/api/auth/totp/setup', {});
    setTotpQR(r);
  }
  async function confirmTotp() {
    await api.post('/api/auth/totp/confirm', { code: totpCode });
    setTotpQR(null); refresh();
  }

  const [cfTesting, setCfTesting] = useState(false);
  const [cfResult, setCfResult] = useState(null);
  const [detectingIp, setDetectingIp] = useState(false);

  const sDraft = { ...settings, ...values };
  const tokenSet = (sDraft.cloudflare_token_set ?? '0') === '1';
  const { data: cfZones } = useQuery({
    queryKey: ['cloudflare-zones'],
    queryFn: () => api.get('/api/cloudflare/zones'),
    enabled: tokenSet,
    retry: false,
  });

  async function testCloudflare() {
    setCfTesting(true);
    setCfResult(null);
    try {
      const token = values.cloudflare_api_token?.trim();
      const result = await api.post('/api/cloudflare/verify', token ? { token } : {});
      setCfResult({ ok: true, status: result.status });
      if (token) {
        await api.put('/api/settings', { cloudflare_api_token: token });
        setValues((v) => ({ ...v, cloudflare_api_token: '' }));
        qc.invalidateQueries(['settings']);
        qc.invalidateQueries(['cloudflare-zones']);
      }
    } catch (e) {
      setCfResult({ ok: false, error: e.message });
    } finally {
      setCfTesting(false);
    }
  }

  async function disconnectCloudflare() {
    await api.put('/api/settings', { cloudflare_api_token: null });
    setCfResult(null);
    qc.invalidateQueries(['settings']);
    qc.invalidateQueries(['cloudflare-zones']);
  }

  async function detectIp() {
    setDetectingIp(true);
    try {
      const found = await api.get('/api/cloudflare/server-ip?refresh=1');
      setValues((v) => ({ ...v, server_public_ip: found.ip }));
    } catch (e) {
      setCfResult({ ok: false, error: e.message });
    } finally {
      setDetectingIp(false);
    }
  }

  const s = sDraft;
  const zoneCount = cfZones?.zones?.length ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader><CardTitle>Alerts</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-xs font-medium">CPU alert %</label><Input value={s.alert_cpu_pct ?? ''} onChange={update('alert_cpu_pct')} type="number" min="0" max="100" /></div>
            <div><label className="text-xs font-medium">Memory alert %</label><Input value={s.alert_mem_pct ?? ''} onChange={update('alert_mem_pct')} type="number" min="0" max="100" /></div>
            <div><label className="text-xs font-medium">Disk alert %</label><Input value={s.alert_disk_pct ?? ''} onChange={update('alert_disk_pct')} type="number" min="0" max="100" /></div>
          </div>
          <div><label className="text-xs font-medium">Discord webhook</label><Input value={s.discord_webhook ?? ''} onChange={update('discord_webhook')} placeholder="https://discord.com/api/webhooks/…" /></div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save}>Save settings</Button>
            {saved && <span className="text-xs text-green-600">Saved!</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Cloudflare
            {tokenSet ? <Badge variant="success">Connected</Badge> : <Badge variant="outline">Not connected</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Create an API token with Zone Read, Zone Edit, DNS Read, and DNS Edit. Add Account Read if you also want to register new domains. The token is encrypted and is not shown again after you save it.
          </p>
          <div>
            <label className="text-xs font-medium">API token</label>
            <Input
              type="password"
              autoComplete="off"
              value={s.cloudflare_api_token ?? ''}
              onChange={update('cloudflare_api_token')}
              placeholder={tokenSet ? 'Token saved — paste a new one to replace it' : 'Paste Cloudflare API token'}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={(s.cloudflare_auto_dns ?? '0') === '1'}
              onChange={(e) => setValues((v) => ({ ...v, cloudflare_auto_dns: e.target.checked ? '1' : '0' }))}
            />
            Automatically create DNS records when adding sites
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <label className="text-xs font-medium">Server public IP</label>
              <Input
                value={s.server_public_ip ?? ''}
                onChange={update('server_public_ip')}
                placeholder="Auto-detected when empty"
              />
            </div>
            <Button type="button" size="sm" variant="outline" onClick={detectIp} loading={detectingIp}>Detect IP</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save}>Save settings</Button>
            <Button size="sm" variant="outline" onClick={testCloudflare} loading={cfTesting} disabled={!tokenSet && !values.cloudflare_api_token?.trim()}>
              Test connection
            </Button>
            {tokenSet && (
              <Button size="sm" variant="ghost" onClick={disconnectCloudflare}>Disconnect</Button>
            )}
            {saved && <span className="text-xs text-green-600">Saved!</span>}
          </div>
          {cfResult?.ok && <p className="text-sm text-green-600">Token is valid ({cfResult.status}).</p>}
          {cfResult && !cfResult.ok && <p className="text-sm text-destructive">{cfResult.error}</p>}
          {tokenSet && (
            <p className="text-sm text-muted-foreground">
              {cfZones?.configured ? `${zoneCount} zone${zoneCount === 1 ? '' : 's'} available.` : 'Checking zones…'}
              {' '}<Link to="/cloudflare" className="text-primary hover:underline">Manage domains</Link>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Two-Factor Authentication</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {user?.totp_enabled ? (
            <p className="text-sm text-green-600">✓ 2FA is enabled on your account.</p>
          ) : (
            <>
              {!totpQR ? (
                <Button size="sm" onClick={setupTotp}>Setup 2FA</Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm">Scan this OTP URL in your authenticator app:</p>
                  <pre className="rounded bg-muted p-2 text-xs break-all">{totpQR.otpauth}</pre>
                  <p className="text-xs text-muted-foreground">or use secret: <code>{totpQR.secret}</code></p>
                  <div className="flex gap-2">
                    <Input className="w-32" placeholder="000000" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} maxLength={6} />
                    <Button size="sm" onClick={confirmTotp}>Verify & Enable</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
