import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card.jsx';
import Badge from '../components/ui/Badge.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import { formatBytes, statusColor } from '../lib/utils.js';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

function MetricCard({ label, value, unit, color = 'text-foreground' }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={`mt-1 text-3xl font-bold ${color}`}>{value}<span className="text-base font-normal text-muted-foreground ml-1">{unit}</span></p>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: metrics, isLoading } = useQuery({
    queryKey: ['metrics'],
    queryFn: () => api.get('/api/metrics'),
    refetchInterval: 5000,
  });
  const { data: history = [] } = useQuery({
    queryKey: ['metrics-history'],
    queryFn: () => api.get('/api/metrics/history?limit=60'),
    refetchInterval: 10_000,
  });
  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.get('/api/sites'),
    refetchInterval: 30_000,
  });
  const { data: engines } = useQuery({
    queryKey: ['db-engines'],
    queryFn: () => api.get('/api/databases'),
    staleTime: 30_000,
  });

  if (isLoading) return <div className="flex justify-center p-16"><Spinner size="lg" /></div>;

  const cpu  = metrics?.cpu  ?? 0;
  const mem  = metrics?.mem?.percent ?? 0;
  const disk = metrics?.disk?.percent ?? 0;
  const cpuColor  = cpu  > 85 ? 'text-red-500' : cpu  > 65 ? 'text-yellow-500' : 'text-green-500';
  const memColor  = mem  > 85 ? 'text-red-500' : mem  > 65 ? 'text-yellow-500' : 'text-foreground';
  const diskColor = disk > 85 ? 'text-red-500' : disk > 65 ? 'text-yellow-500' : 'text-foreground';

  const chartData = history.map((r) => ({
    ts:  new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    cpu: r.cpu_pct,
    mem: r.mem_pct,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard label="CPU" value={cpu.toFixed(1)} unit="%" color={cpuColor} />
        <MetricCard label="Memory" value={mem.toFixed(1)} unit="%" color={memColor} />
        <MetricCard label="Disk" value={disk.toFixed(1)} unit="%" color={diskColor} />
        <MetricCard label="Load (1m)" value={metrics?.load?.l1?.toFixed(2) ?? '—'} unit="" />
      </div>

      {/* Mem detail */}
      {metrics?.mem && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm text-muted-foreground">
          <div><span className="font-medium text-foreground">Total RAM</span><br />{formatBytes(metrics.mem.total)}</div>
          <div><span className="font-medium text-foreground">Used</span><br />{formatBytes(metrics.mem.used)}</div>
          <div><span className="font-medium text-foreground">Disk used</span><br />{formatBytes(metrics.disk?.used ?? 0)}</div>
          <div><span className="font-medium text-foreground">Disk total</span><br />{formatBytes(metrics.disk?.total ?? 0)}</div>
        </div>
      )}

      {/* Chart */}
      {chartData.length > 1 && (
        <Card>
          <CardHeader><CardTitle>CPU & Memory (last hour)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData}>
                <XAxis dataKey="ts" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => `${v?.toFixed(1)}%`} />
                <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fill="#3b82f680" strokeWidth={2} name="CPU" />
                <Area type="monotone" dataKey="mem" stroke="#8b5cf6" fill="#8b5cf680" strokeWidth={2} name="Memory" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Sites */}
      <Card>
        <CardHeader><CardTitle>Sites ({sites.length})</CardTitle></CardHeader>
        <CardContent>
          {sites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sites yet. <a href="/sites/new" className="text-primary underline">Create your first site.</a></p>
          ) : (
            <div className="divide-y divide-border">
              {sites.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2">
                  <div>
                    <a href={`/sites/${s.slug}`} className="font-medium hover:text-primary">{s.name}</a>
                    <p className="text-xs text-muted-foreground">{s.domain ?? `port ${s.port}`} · {s.type} · PHP {s.php_version}</p>
                  </div>
                  <Badge variant={s.status === 'online' ? 'success' : s.status === 'error' ? 'destructive' : 'secondary'}>
                    {s.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
