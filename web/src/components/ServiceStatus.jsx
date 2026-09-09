import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/utils.js';
import { pickImportant, isUnitActive } from '../lib/services.js';

function dotClass(s) {
  if (isUnitActive(s)) return 'bg-green-500';
  if (s.active === 'failed') return 'bg-red-500';
  return 'bg-zinc-400';
}

export default function ServiceStatusChips({ services = [], compact = false, className }) {
  const items = pickImportant(services);
  if (!items.length) return null;

  return (
    <div className={cn('flex items-center gap-1.5 overflow-x-auto', className)} aria-label="Important service status">
      {items.map((s) => (
        <Link
          key={s.unit}
          to={`/services?q=${encodeURIComponent(s.unit.replace(/\.service$/, ''))}`}
          title={`${s.label}: ${s.active}`}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs',
            'hover:bg-accent transition-colors',
            compact ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', dotClass(s))} aria-hidden />
          <span className="whitespace-nowrap">{s.label}</span>
          {!compact && (
            <span className="text-muted-foreground">{s.active}</span>
          )}
        </Link>
      ))}
    </div>
  );
}
