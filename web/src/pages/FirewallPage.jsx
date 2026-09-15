import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';
import Badge from '../components/ui/Badge.jsx';
import DangerConfirmDialog from '../components/DangerConfirmDialog.jsx';
import { ShieldAlert, ShieldOff, ShieldCheck, Trash2 } from 'lucide-react';

const SELECT_CLASS = 'h-9 rounded-md border border-input bg-transparent px-3 text-sm';

function isConfirmError(e) {
  return e?.code === 'confirm' || e?.data?.code === 'confirm';
}

function sensitiveFrom(e) {
  return e?.data?.sensitive ?? e?.sensitive ?? null;
}

function classifyLocal({ port, to = '', comment = '', panelPort }) {
  const n = Number(port);
  const hay = `${to} ${comment}`.toLowerCase();
  if (n === 22 || /\b(ssh|openssh)\b/.test(hay)) {
    return {
      id: 'ssh',
      label: 'SSH',
      level: 'critical',
      title: 'This can lock you out of SSH',
      message: 'Denying or removing SSH (port 22) can immediately disconnect you from this server. Make sure you have another way in before continuing.',
    };
  }
  if (panelPort && n === Number(panelPort)) {
    return {
      id: 'panel',
      label: 'iQPanel',
      level: 'critical',
      title: 'This can lock you out of the panel',
      message: `Port ${panelPort} is used by iQPanel. Blocking it can cut off this web interface.`,
    };
  }
  if (n === 443 || /\bhttps\b/.test(hay)) {
    return {
      id: 'https',
      label: 'HTTPS',
      level: 'high',
      title: 'This can take sites offline',
      message: 'Blocking HTTPS (port 443) will stop encrypted web traffic to sites on this server.',
    };
  }
  if (n === 80 || /\bhttp\b/.test(hay)) {
    return {
      id: 'http',
      label: 'HTTP',
      level: 'high',
      title: 'This can take sites offline',
      message: 'Blocking HTTP (port 80) will stop unencrypted web traffic and HTTP-01 certificate challenges.',
    };
  }
  if (n === 3306) {
    return {
      id: 'mysql',
      label: 'MySQL',
      level: 'high',
      title: 'This can break databases',
      message: 'Blocking MySQL/MariaDB (port 3306) can cut off applications that connect to the database.',
    };
  }
  if (n === 5432) {
    return {
      id: 'postgres',
      label: 'PostgreSQL',
      level: 'high',
      title: 'This can break databases',
      message: 'Blocking PostgreSQL (port 5432) can cut off applications that connect to the database.',
    };
  }
  if (n === 6379) {
    return {
      id: 'redis',
      label: 'Redis',
      level: 'high',
      title: 'This can break cache and queues',
      message: 'Blocking Redis (port 6379) can stop cache, sessions, and queue workers.',
    };
  }
  return null;
}

function confirmPhraseFor(reason) {
  if (!reason) return 'CONFIRM';
  if (reason.id === 'ssh' || reason.label === 'SSH') return 'DENY SSH';
  if (reason.id === 'panel') return 'DENY PANEL';
  if (reason.id === 'disable') return 'DISABLE FIREWALL';
  if (reason.level === 'critical') return 'I UNDERSTAND';
  return null;
}

export default function FirewallPage() {
  const qc = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ['fw-status'],
    queryFn: () => api.get('/api/firewall/status'),
    refetchInterval: 10_000,
  });
  const { data: listeners = [] } = useQuery({
    queryKey: ['fw-listeners'],
    queryFn: () => api.get('/api/firewall/listeners'),
    refetchInterval: 15_000,
  });

  const [port, setPort] = useState('');
  const [proto, setProto] = useState('tcp');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null);

  const rules = Array.isArray(status?.rules) ? status.rules : [];
  const defaults = status?.defaults ?? {};
  const panelPort = status?.panel_port;
  const active = status?.active;
  const listenerRows = Array.isArray(listeners) ? listeners : [];

  const presets = useMemo(() => {
    const list = [
      { label: 'SSH', port: 22, comment: 'SSH' },
      { label: 'HTTP', port: 80, comment: 'HTTP' },
      { label: 'HTTPS', port: 443, comment: 'HTTPS' },
    ];
    if (panelPort && ![22, 80, 443].includes(Number(panelPort))) {
      list.push({ label: 'Panel', port: Number(panelPort), comment: 'iQPanel' });
    }
    return list;
  }, [panelPort]);

  function refresh() {
    qc.invalidateQueries(['fw-status']);
    qc.invalidateQueries(['fw-listeners']);
  }

  async function run(fn) {
    setLoading(true);
    setError('');
    try {
      await fn();
      refresh();
    } catch (e) {
      if (isConfirmError(e)) {
        const reason = sensitiveFrom(e);
        setPending({
          reason,
          phrase: confirmPhraseFor(reason),
          retry: () => fn(true),
        });
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }

  function askOrRun(reason, action) {
    if (reason) {
      setPending({
        reason,
        phrase: confirmPhraseFor(reason),
        retry: () => action(true),
      });
      return;
    }
    run(() => action(false));
  }

  async function addRule(action, { confirmed = false, preset } = {}) {
    const n = Number(preset?.port ?? port);
    const note = preset?.comment ?? comment;
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      setError('Enter a valid port');
      return;
    }
    const body = { port: n, proto, comment: note || undefined, confirm: confirmed };
    const reason = action === 'deny'
      ? classifyLocal({ port: n, comment: note, panelPort })
      : null;
    if (action === 'deny' && reason && !confirmed) {
      setPending({
        reason,
        phrase: confirmPhraseFor(reason),
        retry: () => addRule('deny', { confirmed: true, preset: { port: n, comment: note } }),
      });
      return;
    }
    await run(() => api.post(`/api/firewall/${action}`, body));
    setPort('');
    setComment('');
  }

  function denyRule(rule) {
    const portNum = rule.ports?.[0];
    const reason = rule.sensitive || classifyLocal({
      port: portNum, to: rule.to, comment: rule.comment, panelPort,
    });
    askOrRun(reason, (confirmed) => {
      if (portNum) return api.post('/api/firewall/deny', { port: portNum, proto: 'tcp', confirm: confirmed });
      throw new Error('Cannot deny this rule by port; delete it instead');
    });
  }

  function deleteRule(rule) {
    const closingAllow = String(rule.action).toUpperCase() === 'ALLOW';
    const reason = closingAllow
      ? (rule.sensitive || classifyLocal({ port: rule.ports?.[0], to: rule.to, comment: rule.comment, panelPort }))
      : null;
    askOrRun(reason, (confirmed) => api.delete('/api/firewall/rule', { number: rule.number, confirm: confirmed }));
  }

  function setEnabled(next) {
    if (next) {
      const sshOpen = rules.some((r) => r.action === 'ALLOW' && (
        (r.ports ?? []).includes(22) || /\b(ssh|openssh)\b/i.test(`${r.to} ${r.comment ?? ''}`)
      ));
      const reason = sshOpen ? null : {
        id: 'enable-no-ssh',
        label: 'SSH',
        level: 'critical',
        title: 'Enable firewall without SSH access',
        message: 'UFW has no allow rule for SSH (port 22). Enabling a default-deny firewall can lock you out of this server.',
      };
      askOrRun(reason, (confirmed) => api.post('/api/firewall/enable', { confirm: confirmed }));
      return;
    }
    askOrRun({
      id: 'disable',
      label: 'Firewall',
      level: 'critical',
      title: 'Disable the firewall',
      message: 'Disabling UFW opens every port on this server. Only continue if you understand the exposure.',
    }, (confirmed) => api.post('/api/firewall/disable', { confirm: confirmed }));
  }

  function changeDefault(direction, policy) {
    const reason = direction === 'incoming' && policy === 'deny'
      ? {
        id: 'default-deny',
        label: 'Incoming',
        level: 'high',
        title: 'Default deny incoming traffic',
        message: 'New incoming connections will be blocked unless a matching allow rule exists. Confirm SSH and the panel port stay allowed.',
      }
      : null;
    askOrRun(reason, (confirmed) => api.post('/api/firewall/default', { direction, policy, confirm: confirmed }));
  }

  async function confirmPending() {
    const job = pending;
    if (!job) return;
    setPending(null);
    await run(() => job.retry());
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Firewall & Ports</h1>
          <p className="text-sm text-muted-foreground">Manage UFW rules. Blocking SSH or the panel port can lock you out.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={active === true ? 'success' : active === false ? 'destructive' : 'secondary'}>
            {active === true ? 'Active' : active === false ? 'Inactive' : 'Unknown'}
          </Badge>
          {active === true ? (
            <Button size="sm" variant="destructive" onClick={() => setEnabled(false)} loading={loading} disabled={loading}>
              <ShieldOff className="h-3.5 w-3.5" /> Disable
            </Button>
          ) : (
            <Button size="sm" onClick={() => setEnabled(true)} loading={loading} disabled={loading}>
              <ShieldCheck className="h-3.5 w-3.5" /> Enable
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Default policy</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {['incoming', 'outgoing'].map((direction) => (
              <div key={direction} className="space-y-1">
                <label className="text-xs font-medium capitalize" htmlFor={`fw-default-${direction}`}>{direction}</label>
                <select
                  id={`fw-default-${direction}`}
                  className={`${SELECT_CLASS} w-full`}
                  value={defaults[direction] ?? ''}
                  disabled={loading}
                  onChange={(e) => changeDefault(direction, e.target.value)}
                >
                  <option value="" disabled>Unknown</option>
                  <option value="allow">Allow</option>
                  <option value="deny">Deny</option>
                  <option value="reject">Reject</option>
                </select>
              </div>
            ))}
            {status?.logging && (
              <p className="sm:col-span-2 text-xs text-muted-foreground">Logging: {status.logging}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Add rule</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <Button key={p.label} type="button" size="sm" variant="outline" onClick={() => { setPort(String(p.port)); setComment(p.comment); }}>
                  {p.label} {p.port}
                </Button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
              <Input
                type="number"
                min="1"
                max="65535"
                placeholder="22"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                aria-label="Port"
              />
              <select className={SELECT_CLASS} value={proto} onChange={(e) => setProto(e.target.value)} aria-label="Protocol">
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
              <Input
                placeholder="Comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                aria-label="Comment"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => addRule('allow')} loading={loading} disabled={!port}>Allow</Button>
              <Button variant="destructive" onClick={() => addRule('deny')} loading={loading} disabled={!port}>
                Disallow
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Rules</CardTitle></CardHeader>
        <CardContent className="p-0">
          {rules.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No numbered UFW rules. Add an allow or deny rule above.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">To</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium">From</th>
                    <th className="px-4 py-2 font-medium">Notes</th>
                    <th className="px-4 py-2 font-medium text-right">Manage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rules.map((rule) => {
                    const sensitive = rule.sensitive;
                    const denyLike = rule.action === 'DENY' || rule.action === 'REJECT';
                    return (
                      <tr
                        key={rule.number}
                        className={sensitive ? 'bg-red-950/40' : undefined}
                      >
                        <td className="px-4 py-2 font-mono text-xs">{rule.number}</td>
                        <td className="px-4 py-2 font-mono text-xs">
                          {rule.to}
                          {rule.ipv6 ? <span className="ml-1 text-muted-foreground">v6</span> : null}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant={denyLike ? 'destructive' : 'success'}>
                            {rule.action} {rule.direction}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-xs">{rule.from}</td>
                        <td className="px-4 py-2">
                          {sensitive ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                              <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                              {sensitive.label}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">{rule.comment || '—'}</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end gap-1">
                            {rule.action === 'ALLOW' && (
                              <Button size="sm" variant="destructive" onClick={() => denyRule(rule)} disabled={loading}>
                                Disallow
                              </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => deleteRule(rule)} disabled={loading} aria-label={`Delete rule ${rule.number}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Active listeners</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {listenerRows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No listening ports reported.</p>
            ) : listenerRows.map((l, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-2 text-xs font-mono">
                <span className="w-16 text-muted-foreground">{l.state}</span>
                <span className="flex-1">{l.local}</span>
                <span className="text-muted-foreground">{l.process}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {status?.output ? (
        <Card>
          <CardHeader><CardTitle>Raw UFW status</CardTitle></CardHeader>
          <CardContent>
            <pre className="text-xs font-mono bg-muted p-3 rounded-md whitespace-pre-wrap">{status.output}</pre>
          </CardContent>
        </Card>
      ) : null}

      <DangerConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(open) => { if (!open) setPending(null); }}
        title={pending?.reason?.title ?? 'Confirm sensitive firewall change'}
        description={pending?.reason?.message ?? 'This change can lock you out of the server or take sites offline.'}
        confirmPhrase={pending?.phrase}
        confirmLabel="Apply anyway"
        loading={loading}
        level={pending?.reason?.level === 'high' ? 'high' : 'critical'}
        onConfirm={confirmPending}
      />
    </div>
  );
}
