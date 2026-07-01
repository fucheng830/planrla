import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { Badge, Button } from '../../shared/view/ui';
import { useCloudAccount } from './context/CloudAccountContext';
import CloudLoginModal from './CloudLoginModal';

export default function CloudAccountSection() {
  const { t } = useTranslation('settings');
  const { user, loading, logout } = useCloudAccount();
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <img src="/logo.svg" alt="Planrla" className="h-5 w-5" />
        <h3 className="text-lg font-semibold">{t('apiKeys.remoteAccess.title')}</h3>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        {t('apiKeys.remoteAccess.description')}
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('apiKeys.remoteAccess.checking')}</p>
      ) : user ? (
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
              <img src="/logo.svg" alt="Planrla" className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium">{user.email}</div>
              <div className="mt-0.5 flex items-center gap-2">
                <Badge variant="secondary" className="capitalize">{user.plan}</Badge>
                <span className="text-xs text-muted-foreground">api.planrla.com</span>
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => { void logout(); }}>
            <LogOut className="mr-1 h-4 w-4" />
            {t('apiKeys.remoteAccess.signOut')}
          </Button>
        </div>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <img src="/logo.svg" alt="Planrla" className="mr-1 h-4 w-4" />
          {t('apiKeys.remoteAccess.connectButton')}
        </Button>
      )}

      <CloudLoginModal open={open} onOpenChange={setOpen} />
    </div>
  );
}
