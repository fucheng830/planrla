import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, LogOut, RefreshCw, Smartphone } from 'lucide-react';

import { Badge, Button } from '../../shared/view/ui';
import { authenticatedFetch } from '../../utils/api';
import {
  cloudDeviceUrl,
  cloudListDevices,
  cloudRegisterDevice,
  cloudUsage,
  type CloudDevice,
  type CloudUsage,
} from '../../utils/cloudApi';
import CloudLoginModal from './CloudLoginModal';
import { useCloudAccount } from './context/CloudAccountContext';

type RelayState = 'stopped' | 'connecting' | 'online' | 'reconnecting';

interface RelayStatus {
  enabled: boolean;
  configured: boolean;
  state: RelayState;
  relayUrl: string;
  deviceName: string;
  deviceTokenMasked: string;
  stats: {
    connectedAt: number | null;
    reconnects: number;
    httpRequests: number;
    wsStreams: number;
    lastError: string | null;
  };
}

const RELAY_POLL_MS = 5_000;

const RELAY_DOT: Record<RelayState, string> = {
  online: 'bg-emerald-500',
  connecting: 'bg-amber-500 animate-pulse',
  reconnecting: 'bg-amber-500 animate-pulse',
  stopped: 'bg-muted-foreground/40',
};

export default function CloudAccountSection() {
  const { t } = useTranslation('settings');
  const { user, token, loading, logout } = useCloudAccount();
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<CloudDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [relay, setRelay] = useState<RelayStatus | null>(null);
  const [relayBusy, setRelayBusy] = useState(false);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [usage, setUsage] = useState<CloudUsage | null>(null);
  const [copiedDeviceId, setCopiedDeviceId] = useState<string | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const loadRelay = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/relay/status');
      if (!res.ok) return;
      setRelay(await res.json() as RelayStatus);
      setRelayError(null);
    } catch {
      // transient (server restarting) — keep the last known status, no error spam
    }
  }, []);

  useEffect(() => {
    if (user && token) void loadDevices();
    else setDevices([]);
  }, [loadDevices, token, user]);

  useEffect(() => {
    void loadRelay();
    const timer = setInterval(() => void loadRelay(), RELAY_POLL_MS);
    return () => clearInterval(timer);
  }, [loadRelay]);

  // Cloud-side metering (authoritative for the future paywall) — slower poll.
  useEffect(() => {
    if (!token) {
      setUsage(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const u = await cloudUsage(token);
        if (!cancelled) setUsage(u);
      } catch {
        // usage endpoint not deployed yet or transient — silent
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token]);

  useEffect(() => () => {
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
  }, []);

  const setRelayFromResponse = async (res: Response) => {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `relay request failed (${res.status})`);
    }
    setRelay(await res.json() as RelayStatus);
  };

  // Registering this desktop also starts the outbound relay with the fresh
  // token — one click from "signed in" to "phone can reach this machine".
  const registerThisDesktop = async () => {
    if (!token) return;
    setRegistering(true);
    setDevicesError(null);
    setRelayError(null);
    try {
      const deviceName = t('apiKeys.remoteAccess.defaultDeviceName');
      const device = await cloudRegisterDevice(token, deviceName);
      setDevices((current) => [device, ...current.filter((item) => item.id !== device.id)]);
      await setRelayFromResponse(await authenticatedFetch('/api/relay/enable', {
        method: 'POST',
        body: JSON.stringify({ deviceToken: device.token, deviceName }),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/relay/i.test(message)) setRelayError(t('apiKeys.remoteAccess.relay.enableFailed', { message }));
      else setDevicesError(message);
    } finally {
      setRegistering(false);
    }
  };

  const toggleRelay = async (enable: boolean) => {
    setRelayBusy(true);
    setRelayError(null);
    try {
      await setRelayFromResponse(await authenticatedFetch(`/api/relay/${enable ? 'enable' : 'disable'}`, {
        method: 'POST',
        ...(enable ? { body: JSON.stringify({}) } : {}),
      }));
    } catch (error) {
      setRelayError(error instanceof Error
        ? t('apiKeys.remoteAccess.relay.enableFailed', { message: error.message })
        : t('apiKeys.remoteAccess.relay.enableFailed', { message: String(error) }));
    } finally {
      setRelayBusy(false);
    }
  };

  const copyDeviceLink = async (device: CloudDevice) => {
    try {
      await navigator.clipboard.writeText(cloudDeviceUrl(device.token));
      setCopiedDeviceId(device.id);
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => setCopiedDeviceId(null), 2_000);
    } catch {
      // clipboard unavailable (insecure context) — nothing actionable to show
    }
  };

  const relayStateLabel = (state: RelayState): string => t(`apiKeys.remoteAccess.relay.state.${state}`);

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

            {relay?.configured && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded bg-muted/40 px-3 py-2 text-xs">
                <span className={`inline-block h-2 w-2 rounded-full ${RELAY_DOT[relay.state]}`} />
                <span className="font-medium">{relayStateLabel(relay.state)}</span>
                {relay.state === 'online' && relay.stats.httpRequests > 0 && (
                  <span className="text-muted-foreground">
                    {t('apiKeys.remoteAccess.relay.stats', {
                      requests: relay.stats.httpRequests,
                      reconnects: relay.stats.reconnects,
                    })}
                  </span>
                )}
                {usage && (usage.total.minutes > 0 || usage.total.httpRequests > 0) && (
                  <span className="text-muted-foreground">
                    {t('apiKeys.remoteAccess.relay.cloudUsage', {
                      minutes: usage.total.minutes,
                      requests: usage.total.httpRequests,
                    })}
                  </span>
                )}
                {relay.enabled && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 px-2 text-xs"
                    onClick={() => { void toggleRelay(false); }}
                    disabled={relayBusy}
                  >
                    {t('apiKeys.remoteAccess.relay.turnOff')}
                  </Button>
                )}
              </div>
            )}

            <div className="space-y-2">
              {devices.slice(0, 3).map((device) => (
                <div key={device.id} className="flex items-center justify-between rounded bg-muted/40 px-3 py-2 text-sm">
                  <span className="truncate">{device.name || t('apiKeys.remoteAccess.unnamedDevice')}</span>
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t('apiKeys.remoteAccess.deviceTokenSuffix', { suffix: device.token.slice(-6) })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      title={copiedDeviceId === device.id
                        ? t('apiKeys.remoteAccess.relay.linkCopied')
                        : t('apiKeys.remoteAccess.relay.copyLink')}
                      onClick={() => { void copyDeviceLink(device); }}
                    >
                      {copiedDeviceId === device.id
                        ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                        : <Smartphone className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {devicesError && <p className="mt-2 text-xs text-destructive">{devicesError}</p>}
            {relayError && <p className="mt-2 text-xs text-destructive">{relayError}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => { void registerThisDesktop(); }} disabled={registering || !token}>
                {registering && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('apiKeys.remoteAccess.registerDevice')}
              </Button>
              {relay?.configured && !relay.enabled && (
                <Button size="sm" variant="outline" onClick={() => { void toggleRelay(true); }} disabled={relayBusy}>
                  {relayBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('apiKeys.remoteAccess.relay.turnOn')}
                </Button>
              )}
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
