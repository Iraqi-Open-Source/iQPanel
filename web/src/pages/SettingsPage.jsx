import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth-context.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';

export default function SettingsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: settings = {} } = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/api/settings') });

  const [values, setValues] = useState({});
  const [saved, setSaved]   = useState(false);

  const update = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function save() {
    await api.put('/api/settings', { ...settings, ...values });
    qc.invalidateQueries(['settings']);
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

  const s = { ...settings, ...values };

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
