import React, { useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import Button from './ui/Button.jsx';
import Input from './ui/Input.jsx';

let recipeKeySeq = 0;

export function recipeKey() {
  recipeKeySeq += 1;
  return `recipe-${Date.now()}-${recipeKeySeq}`;
}

export const DEFAULT_LARAVEL_RECIPE = [
  { cmd: 'test -f .env || cp .env.example .env', first_only: 1, enabled: 1 },
  { cmd: 'composer install --no-dev --optimize-autoloader --no-interaction', first_only: 0, enabled: 1 },
  { cmd: 'php artisan key:generate', first_only: 1, enabled: 1 },
  { cmd: 'php artisan storage:link', first_only: 1, enabled: 1 },
  { cmd: 'php artisan migrate --force', first_only: 0, enabled: 1 },
  { cmd: 'npm ci && npm run build', first_only: 0, enabled: 0 },
  { cmd: 'php artisan optimize', first_only: 0, enabled: 1 },
  { cmd: 'php artisan queue:restart', first_only: 0, enabled: 1 },
];

export function normalizeRecipeSteps(steps = []) {
  return steps.map((s) => ({
    _key: s._key || s.id || recipeKey(),
    cmd: s.cmd ?? '',
    first_only: s.first_only ? 1 : 0,
    enabled: s.enabled === 0 || s.enabled === false ? 0 : 1,
  }));
}

export function toApiSteps(steps = []) {
  return steps
    .map(({ cmd, first_only, enabled }) => ({
      cmd: String(cmd ?? '').trim(),
      first_only: first_only ? 1 : 0,
      enabled: enabled ? 1 : 0,
    }))
    .filter((s) => s.cmd);
}

export function moveRecipeStep(steps, from, to) {
  if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) return steps;
  const next = [...steps];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function iconBtnClass(extra = '') {
  return `inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30 ${extra}`;
}

export default function DeployRecipeEditor({ steps, onChange }) {
  const [dragIndex, setDragIndex] = useState(null);

  function update(key, patch) {
    onChange(steps.map((s) => (s._key === key ? { ...s, ...patch } : s)));
  }

  function remove(key) {
    onChange(steps.filter((s) => s._key !== key));
  }

  function add() {
    onChange([...steps, { _key: recipeKey(), cmd: '', first_only: 0, enabled: 1 }]);
  }

  function move(from, to) {
    onChange(moveRecipeStep(steps, from, to));
  }

  return (
    <div className="space-y-2">
      {steps.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          No post-pull commands. Git pull will still run.
        </p>
      )}
      {steps.map((s, i) => (
        <div
          key={s._key}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(e) => {
            e.preventDefault();
            const from = Number(e.dataTransfer.getData('text/plain'));
            if (Number.isInteger(from)) move(from, i);
            setDragIndex(null);
          }}
          className={`flex items-center gap-2 rounded-lg border border-border p-2 ${dragIndex === i ? 'opacity-50' : ''}`}
        >
          <div className="flex shrink-0 items-center">
            <span
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(i));
                setDragIndex(i);
              }}
              onDragEnd={() => setDragIndex(null)}
              className={`${iconBtnClass()} cursor-grab active:cursor-grabbing`}
              aria-label={`Drag to reorder command ${i + 1}`}
              role="button"
              tabIndex={0}
            >
              <GripVertical className="h-4 w-4" aria-hidden="true" />
            </span>
            <button
              type="button"
              className={iconBtnClass()}
              aria-label={`Move command ${i + 1} up`}
              disabled={i === 0}
              onClick={() => move(i, i - 1)}
            >
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={iconBtnClass()}
              aria-label={`Move command ${i + 1} down`}
              disabled={i === steps.length - 1}
              onClick={() => move(i, i + 1)}
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <Input
              className="h-7 font-mono text-xs"
              value={s.cmd}
              onChange={(e) => update(s._key, { cmd: e.target.value })}
              placeholder="command to run after git pull"
              aria-label={`Command ${i + 1}`}
            />
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(s.enabled)}
                  onChange={(e) => update(s._key, { enabled: e.target.checked ? 1 : 0 })}
                />
                Enabled
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(s.first_only)}
                  onChange={(e) => update(s._key, { first_only: e.target.checked ? 1 : 0 })}
                />
                First deploy only
              </label>
            </div>
          </div>
          <button
            type="button"
            onClick={() => remove(s._key)}
            className={iconBtnClass('text-destructive hover:text-destructive')}
            aria-label={`Delete command ${i + 1}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="h-3 w-3" aria-hidden="true" /> Add command
      </Button>
    </div>
  );
}
