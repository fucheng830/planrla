import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, ShieldCheck, Trash2, XCircle } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../shared/view/ui';

type LicenseStatus = {
  status: 'active' | 'expired' | 'invalid' | 'unlicensed';
  plan?: string | null;
  customer?: string | null;
  seats?: number | null;
  features?: string[];
  issuedAt?: string | null;
  expiresAt?: string | null;
  requireLicense?: boolean;
  source?: string | null;
  error?: string;
};

const statusLabels: Record<LicenseStatus['status'], string> = {
  active: 'Active',
  expired: 'Expired',
  invalid: 'Invalid',
  unlicensed: 'Unlicensed',
};

export default function LicenseSettingsTab() {
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadLicense = async () => {
    setIsLoading(true);
    try {
      const response = await authenticatedFetch('/api/license/status');
      const data = await response.json();
      setLicense(data.license);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load license status');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadLicense();
  }, []);

  const activateLicense = async () => {
    if (!licenseKey.trim()) return;
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch('/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: licenseKey.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Activation failed');
      setLicense(data.license);
      setLicenseKey('');
      setMessage('License activated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Activation failed');
    } finally {
      setIsSaving(false);
    }
  };

  const removeLicense = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch('/api/license/activate', { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to remove license');
      setLicense(data.license);
      setMessage('License removed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to remove license');
    } finally {
      setIsSaving(false);
    }
  };

  const isActive = license?.status === 'active';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Commercial License</CardTitle>
              <CardDescription>Activate and review this installation&apos;s commercial license.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading license status…
            </div>
          ) : (
            <div className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {isActive ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : <XCircle className="h-5 w-5 text-amber-500" />}
                  <span className="font-medium">{statusLabels[license?.status || 'unlicensed']}</span>
                  <Badge variant={isActive ? 'default' : 'secondary'}>
                    {license?.plan || 'No plan'}
                  </Badge>
                </div>
                {license?.source && <span className="text-xs text-muted-foreground">Source: {license.source}</span>}
              </div>

              <div className="mt-4 grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
                <div>Customer: <span className="text-foreground">{license?.customer || '—'}</span></div>
                <div>Seats: <span className="text-foreground">{license?.seats ?? '—'}</span></div>
                <div>Issued: <span className="text-foreground">{license?.issuedAt || '—'}</span></div>
                <div>Expires: <span className="text-foreground">{license?.expiresAt || 'Never'}</span></div>
              </div>

              {license?.features && license.features.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {license.features.map((feature) => (
                    <Badge key={feature} variant="outline">{feature}</Badge>
                  ))}
                </div>
              )}

              {license?.error && <p className="mt-4 text-sm text-destructive">{license.error}</p>}
              {license?.requireLicense && !isActive && (
                <p className="mt-4 text-sm text-amber-600 dark:text-amber-400">
                  License enforcement is enabled. Activate a valid license to use protected APIs.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">License key</label>
            <textarea
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              placeholder="nomad_..."
              className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isSaving}
            />
          </div>

          {message && <p className="text-sm text-muted-foreground">{message}</p>}

          <div className="flex flex-wrap gap-2">
            <Button onClick={activateLicense} disabled={isSaving || !licenseKey.trim()}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Activate license
            </Button>
            <Button variant="outline" onClick={removeLicense} disabled={isSaving || !license || license.status === 'unlicensed'}>
              <Trash2 className="mr-2 h-4 w-4" />
              Remove license
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
