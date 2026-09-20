import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Loader2, Smartphone, RefreshCw, Copy, Check, Timer } from 'lucide-react';
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
  // Live countdown + expiry overlay to match the server-side token TTL.
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const generate = useCallback(async () => {
    setLoading(true); setError(null); setQrDataUrl(null); setLanUrls([]); setExpiresAt(null);
    try {
      const lanRes = await authenticatedFetch('/api/auth/lan-info');
      // A stale backend (or SPA fallback) answers unknown API routes with the
      // index.html document — fail with a clear message instead of the cryptic
      // "Unexpected token '<'" JSON parse error.
      const lanCt = lanRes.headers.get('content-type') || '';
      if (!lanRes.ok || !lanCt.includes('application/json')) {
        throw new Error('桌面端服务未包含扫码配对接口，请重启/更新桌面端 Planrla 后再试。');
      }
      const lan = await lanRes.json() as { ips: string[]; port: number };
      const port = lan.port || 3001;
      const urls = (lan.ips ?? []).map((ip) => `http://${ip}:${port}`);
      const pairRes = await authenticatedFetch('/api/auth/pair/create', { method: 'POST' });
      const pairCt = pairRes.headers.get('content-type') || '';
      if (!pairRes.ok || !pairCt.includes('application/json')) {
        throw new Error('桌面端服务未包含扫码配对接口，请重启/更新桌面端 Planrla 后再试。');
      }
      const pair = await pairRes.json() as { token: string; expiresInMs: number };
      const host = window.location.hostname;
      const primary = urls[0] || `http://${host}:${port}`;
      const name = host; // simple, stable label; phone lets user edit it anyway
      const payload = JSON.stringify({ v: 1, t: pair.token, n: name, lan: primary });
      const dataUrl = await QRCode.toDataURL(payload, { width: 240, margin: 1 });
      setQrDataUrl(dataUrl);
      setLanUrls(urls.length ? urls : [primary]);
      setExpiresAt(Date.now() + (pair.expiresInMs || 5 * 60 * 1000));
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void generate(); }, [generate]);

  // 1s ticker only while a QR is live; stops itself after expiry.
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    tickRef.current = id;
    return () => clearInterval(id);
  }, [expiresAt]);

  const remainingMs = expiresAt ? Math.max(0, expiresAt - now) : 0;
  const expired = !!expiresAt && remainingMs <= 0;
  const mm = String(Math.floor(remainingMs / 60000)).padStart(2, '0');
  const ss = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0');

  // Auto-regenerate shortly after expiry so a fresh token is always available.
  useEffect(() => {
    if (!expired) return;
    const t = setTimeout(() => { void generate(); }, 1200);
    return () => clearTimeout(t);
  }, [expired, generate]);

  const copyPrimary = async () => {
    if (!lanUrls.length) return;
    try { await navigator.clipboard.writeText(lanUrls[0]); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2"><Smartphone className="h-4 w-4" />{t('mobilePairing.title', '连接手机')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('mobilePairing.subtitle', '用 Planrla 手机 App 的「扫码导入」扫描下方二维码，一步完成桌面端添加与登录。')}</p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('mobilePairing.generating', '正在生成二维码…')}</div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {!loading && !error && qrDataUrl && (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-4">
          <div className="relative">
            <img src={qrDataUrl} alt="Planrla pairing QR" className={`h-56 w-56 rounded-md bg-white p-2 transition-opacity ${expired ? 'opacity-25' : ''}`} />
            {expired && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-md bg-white/90 text-center">
                <div className="text-sm font-medium text-muted-foreground">二维码已过期</div>
                <div className="text-xs text-muted-foreground">正在自动刷新…</div>
              </div>
            )}
          </div>
          {!expired && expiresAt && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <Timer className="h-4 w-4" />{t('mobilePairing.expiresIn', '有效期')} {mm}:{ss}
            </div>
          )}
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
