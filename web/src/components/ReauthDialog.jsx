import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription } from './ui/Dialog.jsx';
import Button from './ui/Button.jsx';
import Input from './ui/Input.jsx';
import { useAuth } from '../lib/auth-context.jsx';

export default function ReauthDialog({ open, onOpenChange, onSuccess }) {
  const { reauth } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await reauth(password);
      setPassword('');
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      setError(err.message ?? 'Re-authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setPassword(''); onOpenChange(v); }}>
      <DialogContent title="Confirm your password">
        <DialogDescription className="text-sm text-muted-foreground">
          This action needs a recent password confirmation.
        </DialogDescription>
        <form onSubmit={submit} className="space-y-3">
          <Input
            type="password"
            autoFocus
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={loading} disabled={!password}>Confirm</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
