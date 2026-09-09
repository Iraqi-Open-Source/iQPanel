import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card.jsx';
import { buttonClassName } from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import { Plus, Globe, Server } from 'lucide-react';
import { timeAgo } from '../lib/utils.js';

const TYPE_ICONS = {
  laravel: '🔺', php: '🐘', node: '🟢', static: '📄', docker: '🐳',
};

export default function SitesPage() {
  const { data: sites = [], isLoading } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.get('/api/sites'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sites</h1>
        <Link to="/sites/new" className={buttonClassName()}>
          <Plus className="h-4 w-4 shrink-0" /> New Site
        </Link>
      </div>

      {isLoading ? <p className="text-muted-foreground">Loading…</p> : null}

      {!isLoading && sites.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Server className="h-7 w-7 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">No sites yet</h2>
              <p className="text-sm text-muted-foreground max-w-sm">Create your first Laravel or PHP site in seconds.</p>
            </div>
            <Link to="/sites/new" className={buttonClassName()}>
              <Plus className="h-4 w-4 shrink-0" /> Create Site
            </Link>
          </CardContent>
        </Card>
      )}

      {sites.length > 0 && (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sites.map((site) => (
          <Link key={site.id} to={`/sites/${site.slug}`} className="group block">
            <Card className="h-full transition-all group-hover:border-primary/40 group-hover:shadow-md">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{TYPE_ICONS[site.type] ?? '🌐'} {site.name}</p>
                    <p className="text-xs text-muted-foreground">{site.slug}</p>
                  </div>
                  <Badge variant={site.status === 'online' ? 'success' : site.status === 'error' ? 'destructive' : 'secondary'}>
                    {site.status}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p className="flex items-center gap-1"><Globe className="h-3 w-3" />{site.domain ?? `port ${site.port}`}</p>
                  <p>PHP {site.php_version} · {site.webserver}</p>
                </div>
                <p className="text-xs text-muted-foreground">{timeAgo(site.created_at)}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      )}
    </div>
  );
}
