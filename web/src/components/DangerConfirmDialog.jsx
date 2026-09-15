import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription } from './ui/Dialog.jsx';
import Button from './ui/Button.jsx';
import Input from './ui/Input.jsx';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils.js';

/**
 * High-contrast confirmation for irreversible / lockout-risk actions.
 * `confirmPhrase` when set requires the user to type it exactly.
 */
export default function DangerConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmPhrase,
  confirmLabel = 'Continue',
  loading = false,
  onConfirm,
  level = 'critical',
}) {
  const [typed, setTyped] = useState('');
  const needsPhrase = Boolean(confirmPhrase);
  const ready = !needsPhrase || typed.trim() === confirmPhrase;

  useEffect(() => {
    if (open) setTyped('');
  }, [open, confirmPhrase]);

  const critical = level === 'critical';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) onOpenChange(v); }}>
      <DialogContent
        title={title}
        className={cn(
          'border-2',
          critical
            ? 'border-red-600 bg-red-950 text-red-50 sm:max-w-lg'
            : 'border-red-500/70 bg-red-950/80 text-red-50 sm:max-w-lg',
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-white">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <DialogDescription className="text-sm text-red-100">
            {description}
          </DialogDescription>
        </div>
        {needsPhrase && (
          <div className="space-y-1.5">
            <label htmlFor="danger-confirm-phrase" className="text-xs font-medium text-red-100">
              Type <span className="font-mono font-semibold">{confirmPhrase}</span> to confirm
            </label>
            <Input
              id="danger-confirm-phrase"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="border-red-500 bg-red-900/60 text-red-50 placeholder:text-red-300/60 focus-visible:ring-red-400"
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="border-red-400/50 bg-transparent text-red-50 hover:bg-red-900"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={loading}
            disabled={!ready}
            onClick={onConfirm}
            className="bg-red-600 text-white hover:bg-red-500"
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
