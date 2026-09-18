import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Loader2, Smartphone, RefreshCw, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { authenticatedFetch } from '../../../../utils/api';

/**
 * Mobile pairing: shows a QR code the Planrla Android app scans to add this
 * desktop in one step. The QR carries a short-lived one-time pairing token,
 * NOT the account password — the phone exchanges it for a normal JWT via
 * POST /api/auth/pair/exchange.
 */
export default function MobilePairingTab() {
  const { t } = useTranslation('settings');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setLoading(true); setError(null); setQrDataUrl(null); setLanUrls([]);
    try {
      const lanRes = await authenticatedFetch('/api/auth/lan-info');
      if (!lanRes.ok) throw new Error('Failed to get LAN info');
      const lan = await lanRes.json() as { ips: string[]; port: number };
      const port = lan.port || 3001;
      const urls = (lan.ips ?? []).map((ip) => `http://${ip}:${port}`);
      const pairRes = await authenticatedFetch('/api/auth/pair/create', { method: 'POST' });
      if (!pairRes.ok) throw new Error('Failed to create pairing token');
      const pair = await pairRes.json() as { token: string };
      const host = window.location.hostname;
      const primary = urls[0] || `http://${host}:${port}`;
      const name = host; // simple, stable label; phone lets user edit it anyway
      const payload = JSON.stringify({ v: 1, t: pair.token, n: name, lan: primary });
      const dataUrl = await QRCode.toDataURL(payload, { width: 240, margin: 1 });
      setQrDataUrl(dataUrl);
      setLanUrls(urls.length ? urls : [primary]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void generate(); }, [generate]);

  const copyPrimary = async () => {
    if (!lanUrls.length) return;
    try { await navigator.clipboard.writeText(lanUrls[0]); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2"><Smartphone className="h-4 w-4" />{t('mobilePairing.title', '连接手机')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('mobilePairing.subtitle', '用 Planrla 手机 App 的「扫码导入」扫描下方二维码，一步完成桌面端添加与登录。二维码 5 分钟内有效，仅可使用一次。')}</p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('mobilePairing.generating', '正在生成二维码…')}</div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {!loading && !error && qrDataUrl && (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-4">
          <img src={qrDataUrl} alt="Planrla pairing QR" className="h-56 w-56 rounded-md bg-white p-2" />
          <div className="text-xs text-muted-foreground">
            <div className="font-medium text-foreground">{t('mobilePairing.addresses', '桌面端局域网地址')}</div>
            {lanUrls.map((u) => (<div key={u} className="font-mono">{u}</div>))}
          </div>
          <div className="flex gap-2">
            <button onClick={generate} className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"><RefreshCw className="h-4 w-4" />{t('mobilePairing.refresh', '刷新二维码')}</button>
            <button onClick={copyPrimary} className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? t('mobilePairing.copied', '已复制') : t('mobilePairing.copy', '复制地址')}</button>
          </div>
          <p className="text-xs text-muted-foreground">{t('mobilePairing.securityNote', '二维码包含一次性配对令牌（不含密码），5 分钟后或首次使用后即失效。')}</p>
        </div>
      )}
    </div>
  );
}
