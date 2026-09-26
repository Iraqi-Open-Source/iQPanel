import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { cn } from '../lib/utils.js';
import Input from './ui/Input.jsx';

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export function installedPhpVersions(installed = {}, current) {
  const versions = Object.entries(installed)
    .filter(([, ok]) => ok)
    .map(([v]) => v);
  if (current && !versions.includes(current)) versions.unshift(current);
  return versions;
}

export default function SiteAccessFields({
  phpVersion,
  onPhpVersion,
  phpOptions = [],
  showPhp = true,
  showAccess = true,
  usePort,
  onUsePort,
  domain,
  onDomain,
  port,
  onPort,
  sslWarning = false,
  onCloudflareChange,
}) {
  const { data: cloudflare } = useQuery({
    queryKey: ['cloudflare-zones'],
    queryFn: () => api.get('/api/cloudflare/zones'),
    enabled: showAccess,
    staleTime: 60_000,
    retry: false,
  });
  const configured = Boolean(cloudflare?.configured);
  const zones = cloudflare?.zones ?? [];
  const [subdomainMode, setSubdomainMode] = useState(false);
  const [zoneId, setZoneId] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [autoDns, setAutoDns] = useState(true);

  useEffect(() => {
    if (!zoneId && zones[0]) setZoneId(zones[0].id);
  }, [zoneId, zones]);

  const onCloudflareChangeRef = useRef(onCloudflareChange);
  onCloudflareChangeRef.current = onCloudflareChange;
  useEffect(() => {
    onCloudflareChangeRef.current?.({
      configured,
      autoDns,
      subdomainMode,
      subdomain,
      zoneId,
    });
  }, [configured, autoDns, subdomainMode, subdomain, zoneId]);

  function compose(prefix, nextZoneId) {
    const zone = zones.find((z) => z.id === nextZoneId);
    const label = String(prefix ?? '').trim().toLowerCase();
    if (!zone || !label) {
      onDomain('');
      return;
    }
    onDomain(`${label}.${zone.name}`);
  }

  function enableSubdomain(enabled) {
    const id = zoneId || zones[0]?.id || '';
    if (id && id !== zoneId) setZoneId(id);
    setSubdomainMode(enabled);
    if (enabled) compose(subdomain, id);
  }

  return (
    <div className="space-y-4">
      {showPhp && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">PHP Version</label>
          {phpOptions.length ? (
            <select
              className={SELECT_CLASS}
              value={phpVersion}
              onChange={(e) => onPhpVersion(e.target.value)}
            >
              {phpOptions.map((v) => (
                <option key={v} value={v}>PHP {v}</option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-muted-foreground">
              No PHP versions installed.{' '}
              <Link to="/php" className="text-primary hover:underline">Install a version</Link>
              {' '}first.
            </p>
          )}
        </div>
      )}

      {showAccess && (
        <>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => onUsePort(false)}
              className={`flex-1 rounded-lg border p-3 text-sm text-left transition-colors ${!usePort ? 'border-primary bg-primary/5' : 'border-border'}`}
            >
              <p className="font-semibold">Domain</p>
              <p className="text-xs text-muted-foreground">Nginx listens on port 80</p>
            </button>
            <button
              type="button"
              onClick={() => onUsePort(true)}
              className={`flex-1 rounded-lg border p-3 text-sm text-left transition-colors ${usePort ? 'border-primary bg-primary/5' : 'border-border'}`}
            >
              <p className="font-semibold">Port</p>
              <p className="text-xs text-muted-foreground">Custom listen port, or auto 8000–8999</p>
            </button>
          </div>

          {!usePort ? (
            <div className="space-y-3">
              {configured && zones.length > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={subdomainMode}
                    onChange={(e) => enableSubdomain(e.target.checked)}
                  />
                  Create subdomain on Cloudflare
                </label>
              )}
              {configured && subdomainMode ? (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Subdomain</label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="app"
                      value={subdomain}
                      onChange={(e) => {
                        setSubdomain(e.target.value);
                        compose(e.target.value, zoneId);
                      }}
                    />
                    <select
                      className={cn(SELECT_CLASS, 'w-auto shrink-0')}
                      value={zoneId}
                      onChange={(e) => {
                        setZoneId(e.target.value);
                        compose(subdomain, e.target.value);
                      }}
                    >
                      {zones.map((zone) => (
                        <option key={zone.id} value={zone.id}>.{zone.name}</option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {domain ? <>Site domain: <span className="font-medium text-foreground">{domain}</span></> : 'Enter a subdomain label.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Domain</label>
                  <Input placeholder="myapp.example.com" value={domain} onChange={(e) => onDomain(e.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    {configured
                      ? 'Use a hostname on a Cloudflare zone, or create a subdomain above.'
                      : 'Point your DNS A record to this server before issuing SSL.'}
                  </p>
                </div>
              )}
              {configured && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={autoDns}
                    onChange={(e) => setAutoDns(e.target.checked)}
                  />
                  Auto-create DNS record pointing at this server
                </label>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Listen port</label>
              <Input
                type="number"
                min={1}
                max={65535}
                placeholder="Leave empty to auto-assign 8000–8999"
                value={port}
                onChange={(e) => onPort(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to keep the current port or allocate a free one in 8000–8999.
              </p>
            </div>
          )}

          {sslWarning && (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              Changing the domain or switching to a port will deactivate the current SSL certificate. Re-issue it on the SSL tab after saving.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function accessPayload({ phpVersion, usePort, domain, port }) {
  return {
    php_version: phpVersion,
    domain: usePort ? null : (domain || null),
    port: usePort ? (port === '' || port == null ? null : Number(port)) : null,
  };
}

export function validateAccess({ usePort, domain, port, subdomainMode = false, subdomain = '', zoneId = '' }) {
  if (!usePort) {
    if (subdomainMode && !zoneId) return 'Select a Cloudflare zone';
    if (subdomainMode && !String(subdomain ?? '').trim()) return 'Subdomain required';
    if (!String(domain ?? '').trim()) return 'Domain required';
    return null;
  }
  if (port === '' || port == null) return null;
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return 'Invalid port';
  if (n === 80 || n === 443) return 'Ports 80 and 443 are reserved for domain-based sites';
  return null;
}
