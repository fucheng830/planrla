import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, Network, Plus, RefreshCw, ShieldAlert, Trash2, Wifi } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';

type A2aConfig = {
  endpoint: string;
  token: string | null;
  agents: Array<{ id: number; name: string; url: string; description: string | null; hasAuth: boolean }>;
  trustMode?: 'token' | 'lan';
  shareAllSessions?: boolean;
  discoveredPeers?: Array<{ name: string; ip: string; port: number; version: string; lastSeen: number }>;
};

/**
 * A2A settings: shows this machine's A2A endpoint + shared token (copy once
 * and share it with teammates), and manages registered remote agents
 * (one-time add with name + url + token — after that, agents call them by
 * name without any manual token entry).
 */
export default function A2aSettingsTab() {
  const [config, setConfig] = useState<A2aConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Add-agent form
  const [showForm, setShowForm] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');

  const loadConfig = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/a2a-cfg/config');
      const body = await res.json() as { data?: A2aConfig };
      if (body.data) setConfig(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const addAgent = async () => {
    if (!nameInput.trim() || !urlInput.trim()) return;
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await authenticatedFetch('/api/a2a-cfg/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: nameInput.trim(), url: urlInput.trim(), authToken: tokenInput.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      setInfo(`Agent "${nameInput.trim()}" registered.`);
      setNameInput(''); setUrlInput(''); setTokenInput(''); setShowForm(false);
      await loadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeAgent = async (id: number) => {
    setBusy(true); setError(null);
    try {
      const res = await authenticatedFetch(`/api/a2a-cfg/agents/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(await res.text());
      await loadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const updateSettings = async (patch: { trustMode?: 'token' | 'lan'; shareAllSessions?: boolean }) => {
    setBusy(true); setError(null);
    try {
      const res = await authenticatedFetch('/api/a2a-cfg/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* This machine's A2A identity */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
          <Network className="h-4 w-4" />
          本机 A2A 接入点
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          令牌模式下：把下面的地址和令牌发给对方机器（在其 A2A 设置里添加一次）即可互连。
          局域网信任模式下无需分发——节点自动发现、免令牌直连。
        </p>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{config?.endpoint}</code>
            <button
              type="button"
              onClick={() => config && copyToClipboard(config.endpoint, 'endpoint')}
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              title="复制地址"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{config?.token ?? '—'}</code>
            <button
              type="button"
              onClick={() => config?.token && copyToClipboard(config.token, 'token')}
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              title="复制令牌"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
          {copied && <p className="text-xs text-muted-foreground">已复制到剪贴板</p>}
        </div>
      </section>

      {/* Trust mode + share-all-sessions */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
          <ShieldAlert className="h-4 w-4" />
          信任模式
        </h3>
        <div className="mt-3 space-y-2">
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 hover:bg-accent/40">
            <input
              type="radio"
              name="a2a-trust-mode"
              checked={config?.trustMode !== 'lan'}
              disabled={busy}
              onChange={() => void updateSettings({ trustMode: 'token' })}
              className="mt-0.5"
            />
            <span>
              <span className="block text-xs font-medium text-foreground">令牌认证（默认）</span>
              <span className="block text-[11px] text-muted-foreground">远程机器必须携带共享令牌才能访问，适合不受控网络。</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 hover:bg-accent/40">
            <input
              type="radio"
              name="a2a-trust-mode"
              checked={config?.trustMode === 'lan'}
              disabled={busy}
              onChange={() => void updateSettings({ trustMode: 'lan' })}
              className="mt-0.5"
            />
            <span>
              <span className="block text-xs font-medium text-foreground">局域网信任（免配置互连）</span>
              <span className="block text-[11px] text-muted-foreground">
                同一局域网内的 planrla 节点通过 UDP 广播自动发现彼此，直接互通、无需令牌。
                仅信任家庭/办公内网使用——同一网络里的任何设备都能访问你的 A2A 服务。
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border p-2.5 hover:bg-accent/40">
            <input
              type="checkbox"
              checked={config?.shareAllSessions === true}
              disabled={busy}
              onChange={(e) => void updateSettings({ shareAllSessions: e.target.checked })}
            />
            <span>
              <span className="block text-xs font-medium text-foreground">共享全部会话</span>
              <span className="block text-[11px] text-muted-foreground">
                对方可看到并委托本机全部对话（最多列出最近 50 条）；关闭时仅共享逐个开启过 A2A 暴露的会话。
              </span>
            </span>
          </label>
        </div>
      </section>

      {/* Remote agents */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-foreground">远程 Agent</h3>
            <p className="text-xs text-muted-foreground">添加一次后,对话里让 agent 用名字调用即可(如"向 dev-machine 派发任务")。</p>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => void loadConfig()}
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              title="刷新"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="flex h-7 items-center gap-1 rounded bg-primary px-2 text-xs text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              添加
            </button>
          </div>
        </div>

        {/* Add form */}
        {showForm && (
          <div className="mb-3 space-y-2 rounded-md border border-border bg-background p-3">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="名称(如 dev-machine)"
              className="h-8 w-full rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="地址(如 http://192.168.0.13:3001/api/a2a)"
              className="h-8 w-full rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <input
              type="text"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="对方机器的 A2A 令牌(从对方设置页复制)"
              className="h-8 w-full rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
                取消
              </button>
              <button
                type="button"
                disabled={busy || !nameInput.trim() || !urlInput.trim()}
                onClick={() => void addAgent()}
                className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        )}

        {/* Agent list */}
        {config?.agents.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">还没有注册远程 agent</p>
        ) : (
          <ul className="space-y-1">
            {config?.agents.map((agent) => (
              <li key={agent.name} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{agent.name}</span>
                    {agent.hasAuth && <span className="rounded bg-green-500/10 px-1 py-px text-[9px] text-green-600">已配置令牌</span>}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{agent.url}</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeAgent(agent.id)}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                  title="删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Discovered LAN peers */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Wifi className="h-4 w-4" />
              发现的局域网节点
            </h3>
            <p className="text-xs text-muted-foreground">
              开启「局域网信任」后自动出现；对话里可直接用节点名派发任务（如"向 xxx 派发任务"）。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadConfig()}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            title="刷新"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        {(config?.discoveredPeers?.length ?? 0) === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">暂未发现局域网节点（对方需开启局域网信任模式）</p>
        ) : (
          <ul className="space-y-1">
            {config?.discoveredPeers?.map((peer) => (
              <li key={`${peer.name}@${peer.ip}`} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{peer.name}</span>
                    <span className="rounded bg-blue-500/10 px-1 py-px text-[9px] text-blue-600">自动发现</span>
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{peer.ip}:{peer.port} · v{peer.version || '?'}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && <p className="text-xs text-red-500">{error}</p>}
      {info && <p className="text-xs text-green-600">{info}</p>}
    </div>
  );
}
