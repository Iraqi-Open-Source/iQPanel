import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import Spinner from '../components/ui/Spinner.jsx';

export default function ServicesPage() {
  const qc = useQueryClient();
  const { data: services = [], isLoading } = useQuery({
    queryKey: ['services'],
    queryFn:  () => api.get('/api/services'),
    refetchInterval: 10_000,
  });

  async function action(unit, act) {
    try { await api.post(`/api/services/${unit}/${act}`, {}); qc.invalidateQueries(['services']); }
    catch (e) { alert(e.message); }
  }

  if (isLoading) return <div className="flex justify-center p-16"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">System Services</h1>
      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {services.map((s) => (
              <div key={s.unit ?? s.name} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{s.unit ?? s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.description ?? s.Description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={s.active === 'active' || s.ActiveState === 'active' ? 'success' : 'secondary'}>
                    {s.active ?? s.ActiveState}
                  </Badge>
                  {['start','stop','restart'].map((a) => (
                    <Button key={a} size="sm" variant="outline" onClick={() => action(s.unit ?? s.name, a)}>{a}</Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
