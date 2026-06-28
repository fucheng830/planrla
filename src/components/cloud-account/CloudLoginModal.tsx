import { useState } from 'react';
import { Cloud, Loader2, X } from 'lucide-react';
import { Button, Input, Dialog, DialogContent, DialogTitle } from '../../shared/view/ui';
import { useCloudAccount } from './context/CloudAccountContext';

interface CloudLoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CloudLoginModal({ open, onOpenChange }: CloudLoginModalProps) {
  const { login, signup } = useCloudAccount();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = !busy && email.trim().length > 0 && password.length >= 8;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      if (mode === 'signup') await signup(email, password);
      else await login(email, password);
      onOpenChange(false);
      setEmail('');
      setPassword('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0">
        <DialogTitle>CloudCLI Cloud Account</DialogTitle>
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">{mode === 'signup' ? 'Create cloud account' : 'Sign in to cloud'}</h2>
          </div>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <p className="text-sm text-muted-foreground">
            Connect your cc.brainmate.cc account to enable remote access from the phone app.
          </p>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" disabled={busy} />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="at least 8 characters"
              disabled={busy}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            />
          </div>

          {err && <p className="text-sm text-destructive">{err}</p>}

          <Button className="w-full" onClick={handleSubmit} disabled={!canSubmit}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {busy ? '…' : mode === 'signup' ? 'Sign up' : 'Sign in'}
          </Button>

          <button
            type="button"
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setErr(null); }}
          >
            {mode === 'signup' ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
