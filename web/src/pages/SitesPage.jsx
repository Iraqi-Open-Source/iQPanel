import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Card, CardContent } from '../components/ui/Card.jsx';
import Button, { buttonClassName } from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import { Plus, Globe, Server, ExternalLink, Copy, Check } from 'lucide-react';
import { sitePublicUrl, timeAgo } from '../lib/utils.js';

const TYPE_ICONS = {
  laravel: '🔺', php: '🐘', node: '🟢', static: '📄', docker: '🐳',
};

function CopyUrlButton({ url }) {
  const [copied, setCopied] = useState(false);

  async function copy(e) {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement('textarea');
        input.value = url;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full"
      onClick={copy}
      aria-label={copied ? 'URL copied' : 'Copy URL'}
    >
      {copied
        ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        : <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy URL'}
    </Button>
  );
}

function SiteCard({ site }) {
  const url = sitePublicUrl(site);

  return (
    <Card className="h-full transition-all hover:border-primary/40 hover:shadow-md">
      <CardContent className="p-5 space-y-3">
        <Link to={`/sites/${site.slug}`} className="block space-y-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
            <p className="flex items-center gap-1"><Globe className="h-3 w-3" aria-hidden="true" />{site.domain ?? `port ${site.port}`}</p>
            <p>PHP {site.php_version} · {site.webserver}</p>
          </div>
          <p className="text-xs text-muted-foreground">{timeAgo(site.created_at)}</p>
        </Link>
        {url ? (
          <div className="flex flex-col gap-2">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={url}
              className={buttonClassName({ variant: 'outline', size: 'sm', className: 'w-full' })}
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Open in browser
            </a>
            <CopyUrlButton url={url} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

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
          <SiteCard key={site.id} site={site} />
        ))}
      </div>
      )}
    </div>
  );
}
