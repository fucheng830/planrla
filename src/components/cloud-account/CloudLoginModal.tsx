import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
import { Button, Input, Dialog, DialogContent, DialogTitle } from '../../shared/view/ui';
import { useCloudAccount } from './context/CloudAccountContext';

interface CloudLoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CloudLoginModal({ open, onOpenChange }: CloudLoginModalProps) {
  const { t } = useTranslation('settings');
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
      setErr(e instanceof Error ? e.message : t('apiKeys.remoteAccess.errors.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0">
        <DialogTitle>{t('apiKeys.remoteAccess.dialogTitle')}</DialogTitle>
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="Planrla" className="h-5 w-5" />
            <h2 className="text-lg font-semibold">
              {mode === 'signup'
                ? t('apiKeys.remoteAccess.createTitle')
                : t('apiKeys.remoteAccess.signInTitle')}
            </h2>
          </div>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <p className="text-sm text-muted-foreground">
            {t('apiKeys.remoteAccess.dialogDescription')}
          </p>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('apiKeys.remoteAccess.email')}</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('apiKeys.remoteAccess.emailPlaceholder')}
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t('apiKeys.remoteAccess.password')}</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('apiKeys.remoteAccess.passwordPlaceholder')}
              disabled={busy}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            />
          </div>

          {err && <p className="text-sm text-destructive">{err}</p>}

          <Button className="w-full" onClick={handleSubmit} disabled={!canSubmit}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {busy ? '…' : mode === 'signup' ? t('apiKeys.remoteAccess.signUp') : t('apiKeys.remoteAccess.signIn')}
          </Button>

          <button
            type="button"
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setErr(null); }}
          >
            {mode === 'signup'
              ? t('apiKeys.remoteAccess.switchToSignIn')
              : t('apiKeys.remoteAccess.switchToSignUp')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
