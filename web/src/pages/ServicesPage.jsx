import React, { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { Card, CardContent } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import Input from '../components/ui/Input.jsx';
import Spinner from '../components/ui/Spinner.jsx';
import {
  unitName, unitActive, unitDescription, isActionable,
  statusVariant, pickImportant, filterServices, isUnitActive,
} from '../lib/services.js';

export default function ServicesPage() {
  const qc = useQueryClient();
  const [params, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(() => params.get('q') ?? '');

  const { data: services = [], isLoading } = useQuery({
    queryKey: ['services'],
    queryFn:  () => api.get('/api/services'),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    const q = params.get('q') ?? '';
    setQuery((cur) => (cur === q ? cur : q));
  }, [params]);

  function onSearch(value) {
    setQuery(value);
    if (value) setSearchParams({ q: value }, { replace: true });
    else setSearchParams({}, { replace: true });
  }

  const important = useMemo(() => pickImportant(services), [services]);
  const filtered  = useMemo(() => filterServices(services, query), [services, query]);

  async function action(unit, act) {
    try {
      await api.post(`/api/services/${encodeURIComponent(unit)}/${act}`, {});
      qc.invalidateQueries(['services']);
    } catch (e) { alert(e.message); }
  }

  if (isLoading) return <div className="flex justify-center p-16"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">System Services</h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length === services.length
              ? `${services.length} units`
              : `${filtered.length} of ${services.length} units`}
          </p>
        </div>
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search units, description, status…"
            aria-label="Search services"
            className="pl-8"
          />
        </div>
      </div>

      {important.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {important.map((s) => (
            <button
              key={s.unit}
              type="button"
              onClick={() => onSearch(s.unit.replace(/\.service$/, ''))}
              className="rounded-xl border border-border bg-card p-3 text-left hover:bg-accent/40 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium truncate">{s.label}</p>
                <Badge variant={statusVariant(s.active)}>{s.active}</Badge>
              </div>
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{s.unit}</p>
            </button>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {filtered.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                {query ? `No units match “${query}”.` : 'No systemd units reported.'}
              </p>
            )}
            {filtered.map((s) => {
              const unit = unitName(s);
              const active = unitActive(s);
              return (
                <div key={unit} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{unit}</p>
                    <p className="text-xs text-muted-foreground truncate">{unitDescription(s)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={statusVariant(active)}>{active}</Badge>
                    {isActionable(unit) && ['start', 'stop', 'restart'].map((a) => (
                      <Button
                        key={a}
                        size="sm"
                        variant="outline"
                        disabled={a === 'start' && isUnitActive(s)}
                        onClick={() => action(unit, a)}
                      >
                        {a}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
