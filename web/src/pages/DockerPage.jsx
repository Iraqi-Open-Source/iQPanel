import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';

export default function DockerPage() {
  const qc = useQueryClient();
  const { data: status } = useQuery({ queryKey: ['docker-status'], queryFn: () => api.get('/api/docker/status') });
  const { data: containers = [] } = useQuery({ queryKey: ['docker-containers'], queryFn: () => api.get('/api/docker/containers'), refetchInterval: 15_000 });
  const { data: images = [] } = useQuery({ queryKey: ['docker-images'], queryFn: () => api.get('/api/docker/images') });

  if (!status?.available) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Docker</h1>
        <Card><CardContent className="p-8 text-center text-muted-foreground">Docker is not installed. Install it from the <a href="/packages" className="text-primary underline">Packages</a> page.</CardContent></Card>
      </div>
    );
  }

  async function containerAction(id, action) {
    await api.post(`/api/docker/containers/${id}/${action}`, {});
    qc.invalidateQueries(['docker-containers']);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Docker</h1>
      <Card>
        <CardHeader><CardTitle>Containers ({containers.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {containers.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No containers.</p> : (
            <div className="divide-y divide-border">
              {containers.map((c) => (
                <div key={c.ID ?? c.Names} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{c.Names ?? c.ID?.slice(0, 12)}</p>
                    <p className="text-xs text-muted-foreground">{c.Image} · {c.Status}</p>
                  </div>
                  <div className="flex gap-1">
                    {['start','stop','restart'].map((a) => (
                      <Button key={a} size="sm" variant="outline" onClick={() => containerAction(c.ID, a)}>{a}</Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Images ({images.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {images.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No images.</p> : (
            <div className="divide-y divide-border">
              {images.map((i) => (
                <div key={i.ID ?? i.Repository} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>{i.Repository}:{i.Tag}</span>
                  <span className="text-muted-foreground">{i.Size}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
