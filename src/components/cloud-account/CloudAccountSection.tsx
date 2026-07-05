import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, LogOut, RefreshCw } from 'lucide-react';
import { Badge, Button } from '../../shared/view/ui';
import { useCloudAccount } from './context/CloudAccountContext';
import CloudLoginModal from './CloudLoginModal';
import { cloudListDevices, cloudRegisterDevice, type CloudDevice } from '../../utils/cloudApi';

export default function CloudAccountSection() {
  const { t } = useTranslation('settings');
  const { user, token, loading, logout } = useCloudAccount();
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<CloudDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    if (!token) {
      setDevices([]);
      return;
    }
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      setDevices(await cloudListDevices(token));
    } catch (error) {
      setDevicesError(error instanceof Error ? error.message : t('apiKeys.remoteAccess.errors.devicesFailed'));
    } finally {
      setDevicesLoading(false);
    }
  }, [token, t]);

  useEffect(() => {
    if (user && token) void loadDevices();
    else setDevices([]);
  }, [loadDevices, token, user]);

  const registerThisDesktop = async () => {
    if (!token) return;
    setRegistering(true);
    setDevicesError(null);
    try {
      const device = await cloudRegisterDevice(token, t('apiKeys.remoteAccess.defaultDeviceName'));
      setDevices((current) => [device, ...current.filter((item) => item.id !== device.id)]);
    } catch (error) {
      setDevicesError(error instanceof Error ? error.message : t('apiKeys.remoteAccess.errors.registerFailed'));
    } finally {
      setRegistering(false);
    }
  };

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
        <div className="space-y-3">
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

          <div className="rounded-md border p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{t('apiKeys.remoteAccess.devicesTitle')}</div>
                <p className="text-xs text-muted-foreground">
                  {devices.length > 0
                    ? t('apiKeys.remoteAccess.devicesFound', { count: devices.length })
                    : t('apiKeys.remoteAccess.devicesEmpty')}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { void loadDevices(); }} disabled={devicesLoading}>
                {devicesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>

            <div className="space-y-2">
              {devices.slice(0, 3).map((device) => (
                <div key={device.id} className="flex items-center justify-between rounded bg-muted/40 px-3 py-2 text-sm">
                  <span className="truncate">{device.name || t('apiKeys.remoteAccess.unnamedDevice')}</span>
                  <span className="ml-3 shrink-0 text-xs text-muted-foreground">
                    {t('apiKeys.remoteAccess.deviceTokenSuffix', { suffix: device.token.slice(-6) })}
                  </span>
                </div>
              ))}
            </div>

            {devicesError && <p className="mt-2 text-xs text-destructive">{devicesError}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => { void registerThisDesktop(); }} disabled={registering || !token}>
                {registering && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('apiKeys.remoteAccess.registerDevice')}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t('apiKeys.remoteAccess.relayStatusHint')}
              </p>
            </div>
          </div>
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
