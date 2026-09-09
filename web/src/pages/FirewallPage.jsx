import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Input from '../components/ui/Input.jsx';

export default function FirewallPage() {
  const qc = useQueryClient();
  const { data: status } = useQuery({ queryKey: ['fw-status'], queryFn: () => api.get('/api/firewall/status') });
  const { data: listeners = [] } = useQuery({ queryKey: ['fw-listeners'], queryFn: () => api.get('/api/firewall/listeners'), refetchInterval: 15_000 });
  const [port, setPort]     = useState('');
  const [proto, setProto]   = useState('tcp');
  const [loading, setLoading] = useState(false);

  async function allow() {
    setLoading(true);
    try { await api.post('/api/firewall/allow', { port: Number(port), proto }); qc.invalidateQueries(['fw-status']); }
    catch (e) { alert(e.message); }
    finally { setLoading(false); setPort(''); }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Firewall & Ports</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>UFW Status</CardTitle></CardHeader>
          <CardContent>
            <pre className="text-xs font-mono bg-muted p-3 rounded-md whitespace-pre-wrap">{status?.output ?? 'Unavailable'}</pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Open Port</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input type="number" min="1" max="65535" placeholder="8080" value={port} onChange={(e) => setPort(e.target.value)} />
              <select className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" value={proto} onChange={(e) => setProto(e.target.value)}>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
              <Button onClick={allow} loading={loading}>Allow</Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Active Listeners</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {listeners.map((l, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-2 text-xs font-mono">
                <span className="w-16 text-muted-foreground">{l.state}</span>
                <span className="flex-1">{l.local}</span>
                <span className="text-muted-foreground">{l.process}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
