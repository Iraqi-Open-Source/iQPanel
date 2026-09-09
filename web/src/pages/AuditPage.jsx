import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import { timeAgo } from '../lib/utils.js';

export default function AuditPage() {
  const { data: rows = [] } = useQuery({
    queryKey: ['audit'],
    queryFn:  () => api.get('/api/audit?limit=100'),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Audit Log</h1>
      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No audit records.</p> : null}
            {rows.map((r) => (
              <div key={r.id} className="flex items-start justify-between px-4 py-3 text-sm">
                <div>
                  <p>
                    <span className="font-medium font-mono text-xs bg-muted px-1.5 py-0.5 rounded mr-2">{r.action}</span>
                    <span className="text-muted-foreground">{r.target}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {r.user_id ?? 'system'} · {r.ip ?? '—'}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 ml-4">{timeAgo(r.created_at)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
