import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Users } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';

type SyncConfigResponse = {
  configured: boolean;
  cloudUrl: string;
  teamId: string;
  teamName: string;
  instanceId: string;
  instanceName: string;
  instanceTokenMasked: string;
  lastPullAt: string;
};

type InstanceRow = {
  id: string;
  name: string;
  user_id: string;
  email?: string;
  last_sync_at: number | null;
  created_at: number;
};

type SyncResult = {
  pushed: number;
  pulled: number;
  skipped: number;
  deleted: number;
  error?: string;
};

export default function SyncSettingsTab() {
  const [config, setConfig] = useState<SyncConfigResponse | null>(null);
  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Form inputs
  const [cloudUrlInput, setCloudUrlInput] = useState('');
  const [teamNameInput, setTeamNameInput] = useState('');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [instanceNameInput, setInstanceNameInput] = useState('');

  const loadConfig = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/sync/config');
      const cfg = await res.json() as SyncConfigResponse;
      setConfig(cfg);
      setCloudUrlInput(cfg.cloudUrl || 'https://api.planrla.com');
      if (cfg.configured) {
        const ri = await authenticatedFetch('/api/sync/instances');
        if (ri.ok) setInstances(((await ri.json()) as { instances: InstanceRow[] }).instances ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const saveCloudUrl = async () => {
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await authenticatedFetch('/api/sync/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cloudUrl: cloudUrlInput.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setInfo('Cloud URL saved.');
      await loadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createTeam = async () => {
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await authenticatedFetch('/api/sync/team/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: teamNameInput.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json() as { team: { invite_code: string } };
      setInfo(`Team created. Invite code: ${body.team.invite_code} (share it with teammates).`);
      await loadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const joinTeam = async () => {
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await authenticatedFetch('/api/sync/team/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inviteCode: inviteCodeInput.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setInfo('Joined team.');
      await loadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const registerInstance = async () => {
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await authenticatedFetch('/api/sync/instance/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: instanceNameInput.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setInfo('Instance registered. Sync is now active.');
      await loadConfig();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true); setError(null); setInfo(null);
    try {
      const res = await authenticatedFetch('/api/sync/now', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const r = await res.json() as SyncResult;
      if (r.error) setError(r.error);
      else setInfo(`Synced: pushed ${r.pushed}, pulled ${r.pulled}, deleted ${r.deleted}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const configured = config?.configured;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold text-foreground">Team Sync</h2>
        {configured && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            Active
          </span>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Sync kanban tasks across your team's Planrla instances via a shared cloud relay.
        Each teammate runs their own instance; tasks and deletions propagate automatically.
      </p>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {info}
        </div>
      )}

      {/* Step 1: cloud URL — optional; empty applies the official relay */}
        <section className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Cloud URL <span className="font-normal text-muted-foreground">(留空使用默认官方中转，仅自建部署时修改)</span>
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={cloudUrlInput}
            onChange={(e) => setCloudUrlInput(e.target.value)}
            placeholder="https://api.planrla.com"
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          />
          <button
            onClick={saveCloudUrl}
            disabled={busy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </section>

      {/* Step 2a: create or join team */}
      {!config?.teamId && (
        <section className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Create a team</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={teamNameInput}
                onChange={(e) => setTeamNameInput(e.target.value)}
                placeholder="Team name"
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
              <button onClick={createTeam} disabled={busy || !teamNameInput.trim()} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                Create
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">…or join with an invite code</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={inviteCodeInput}
                onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase())}
                placeholder="ABCDEF"
                maxLength={6}
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm uppercase tracking-wider"
              />
              <button onClick={joinTeam} disabled={busy || inviteCodeInput.trim().length < 6} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                Join
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Step 3: register this instance */}
      {config?.teamId && !config.instanceId && (
        <section className="space-y-2">
          <label className="text-sm font-medium text-foreground">Register this instance</label>
          <p className="text-xs text-muted-foreground">Give this Planrla install a name so teammates recognise it.</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={instanceNameInput}
              onChange={(e) => setInstanceNameInput(e.target.value)}
              placeholder="Alice's laptop"
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            />
            <button onClick={registerInstance} disabled={busy} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              Register
            </button>
          </div>
        </section>
      )}

      {/* Active status + sync now + teammates */}
      {configured && (
        <section className="space-y-3">
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="text-sm">
              <div className="font-medium text-foreground">{config?.teamName || 'Team'}</div>
              <div className="text-xs text-muted-foreground">
                Instance: {config?.instanceName || config?.instanceId} · Last sync: {config?.lastPullAt ? new Date(Number(config.lastPullAt)).toLocaleString() : 'never'}
              </div>
            </div>
            <button
              onClick={syncNow}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Sync now
            </button>
          </div>

          <div>
            <div className="mb-1.5 text-sm font-medium text-foreground">Team instances</div>
            <div className="divide-y divide-border rounded-md border border-border">
              {instances.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">No other instances yet.</div>
              )}
              {instances.map((inst) => (
                <div key={inst.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium text-foreground">{inst.name || inst.id}</div>
                    <div className="text-xs text-muted-foreground">{inst.email ?? inst.user_id}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {inst.last_sync_at ? new Date(inst.last_sync_at).toLocaleTimeString() : 'never'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
