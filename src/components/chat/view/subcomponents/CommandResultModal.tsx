import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  BadgeCheck,
  Check,
  CircleHelp,
  Clipboard,
  Coins,
  Cpu,
  Gauge,
  Package,
  Search,
  Server,
  Sparkles,
  TerminalSquare,
  Timer,
  RefreshCw,
  X,
} from 'lucide-react';

import { Badge, Button, Dialog, DialogContent, DialogTitle, Input } from '../../../../shared/view/ui';
import type { LLMProvider, ProviderModelsCacheInfo, ProviderModelsDefinition } from '../../../../types/app';
import type {
  CommandModalPayload,
  CostCommandData,
  HelpCommandData,
  ModelCommandData,
  StatusCommandData,
} from '../../hooks/useChatComposerState';

type CommandResultModalProps = {
  payload: CommandModalPayload | null;
  onClose: () => void;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelCacheCatalog: Partial<Record<LLMProvider, ProviderModelsCacheInfo>>;
  providerModelsRefreshing: boolean;
  onHardRefreshProviderModels: () => void;
  currentSessionId: string | null;
  onSelectProviderModel: (
    provider: LLMProvider,
    model: string,
    sessionId?: string | null,
  ) => Promise<{
    scope: 'default' | 'session';
    changed: boolean;
    model: string;
  }>;
};

type CommandEntry = {
  name: string;
  description?: string;
  namespace?: string;
};

type ModelOption = {
  value: string;
  label?: string;
  description?: string;
};

const formatUpdatedAt = (value: string | undefined, notCachedText: string) => {
  if (!value) {
    return notCachedText;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return notCachedText;
  }

  return parsed.toLocaleString();
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  kimi: 'Kimi Code',
};

const getProviderLabel = (provider: string | undefined, fallback = 'Unknown') => {
  if (!provider) {
    return fallback;
  }

  return PROVIDER_LABELS[provider] || provider;
};

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toLocaleString();
};

function MetricCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  compact = false,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
  tone?: 'neutral' | 'primary' | 'success';
  compact?: boolean;
}) {
  const toneClass =
    tone === 'primary'
      ? 'border-primary/35 bg-primary/10 text-primary'
      : tone === 'success'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
        : 'border-border/70 bg-background/75 text-muted-foreground';

  return (
    <div
      className={`group rounded-2xl border border-border/70 bg-background/75 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      <div className={`inline-flex rounded-xl border ${compact ? 'mb-2 p-1.5' : 'mb-3 p-2'} ${toneClass}`}>
        <Icon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={`${compact ? 'mt-0.5 text-[13px]' : 'mt-1 text-sm'} break-all font-semibold text-foreground`}>{value}</p>
    </div>
  );
}

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 rounded-xl border-border/70 bg-background/75 pl-9 pr-3 shadow-none focus-visible:ring-primary/40"
      />
    </div>
  );
}

function HelpContent({ data }: { data: HelpCommandData }) {
  const { t } = useTranslation('chat');
  const [query, setQuery] = useState('');
  const fallbackCommands = useMemo<CommandEntry[]>(
    () => [
      { name: '/models', description: t('commandModal.help.fallbackCommands.models') },
      { name: '/cost', description: t('commandModal.help.fallbackCommands.cost') },
      { name: '/status', description: t('commandModal.help.fallbackCommands.status') },
      { name: '/memory', description: t('commandModal.help.fallbackCommands.memory') },
      { name: '/config', description: t('commandModal.help.fallbackCommands.config') },
      { name: '/help', description: t('commandModal.help.fallbackCommands.help') },
    ],
    [t],
  );
  const commands = (Array.isArray(data.commands) && data.commands.length > 0
    ? data.commands
    : fallbackCommands) as CommandEntry[];

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return commands;
    }

    return commands.filter((command) => {
      const haystack = `${command.name} ${command.description || ''} ${command.namespace || ''}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [commands, query]);

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-h-0 flex-col gap-3">
        <SearchField value={query} onChange={setQuery} placeholder={t('commandModal.help.filterCommands')} />

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-2 sm:grid-cols-2">
            {filteredCommands.map((command, index) => (
              <div
                key={`${command.namespace || 'builtin'}-${command.name}`}
                className="settings-content-enter rounded-2xl border border-border/70 bg-background/75 p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-muted/25"
                style={{ animationDelay: `${Math.min(index * 18, 160)}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <code className="rounded-lg border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                    {command.name}
                  </code>
                  <Badge variant="secondary" className="shrink-0 text-[10px] capitalize">
                    {command.namespace || t('commandModal.help.builtin')}
                  </Badge>
                </div>
                <p className="mt-3 text-sm leading-5 text-muted-foreground">
                  {command.description || t('commandModal.help.noDescription')}
                </p>
              </div>
            ))}
          </div>

          {filteredCommands.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
              {t('commandModal.help.noCommandsMatch')}
            </div>
          )}
        </div>
      </div>

      <aside className="space-y-3">
        <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <TerminalSquare className="h-4 w-4 text-primary" />
            {t('commandModal.help.syntax')}
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p><code className="text-foreground">/command arg1 arg2</code></p>
            <p><code className="text-foreground">$ARGUMENTS</code> {t('commandModal.help.allArgs')}</p>
            <p><code className="text-foreground">$1</code>, <code className="text-foreground">$2</code> {t('commandModal.help.positionalArgs')}</p>
            <p><code className="text-foreground">@file</code> {t('commandModal.help.fileContents')}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-primary/25 bg-primary/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            {t('commandModal.help.quickTip')}
          </div>
          <p className="text-sm leading-5 text-muted-foreground">
            {t('commandModal.help.quickTipPrefix')} <code className="text-foreground">/</code> {t('commandModal.help.quickTipSuffix')}
          </p>
        </div>
      </aside>
    </div>
  );
}

function ModelsContent({
  data,
  providerModelCatalog,
  providerModelCacheCatalog,
  providerModelsRefreshing,
  onHardRefreshProviderModels,
  currentSessionId,
  onSelectProviderModel,
}: {
  data: ModelCommandData;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelCacheCatalog: Partial<Record<LLMProvider, ProviderModelsCacheInfo>>;
  providerModelsRefreshing: boolean;
  onHardRefreshProviderModels: () => void;
  currentSessionId: string | null;
  onSelectProviderModel: CommandResultModalProps['onSelectProviderModel'];
}) {
  const { t } = useTranslation('chat');
  const [query, setQuery] = useState('');
  const [copiedModel, setCopiedModel] = useState<string | null>(null);
  const [changingModel, setChangingModel] = useState<string | null>(null);
  const [pendingSessionModel, setPendingSessionModel] = useState<string | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const currentProvider = (data?.current?.provider || 'claude') as LLMProvider;
  const currentModel = data?.current?.model || 'Unknown';
  const providerLabel = data?.current?.providerLabel || getProviderLabel(currentProvider);
  const liveDefinition = providerModelCatalog[currentProvider];
  const currentCache = providerModelCacheCatalog[currentProvider] ?? data?.cache;
  const availableOptions = useMemo<ModelOption[]>(() => {
    if (liveDefinition?.OPTIONS && liveDefinition.OPTIONS.length > 0) {
      return liveDefinition.OPTIONS;
    }

    if (Array.isArray(data?.availableOptions) && data.availableOptions.length > 0) {
      return data.availableOptions;
    }

    const availableModels = Array.isArray(data?.availableModels) ? data.availableModels : [];
    return availableModels.map((model) => ({ value: model, label: model }));
  }, [data, liveDefinition]);
  const defaultModel = liveDefinition?.DEFAULT || data?.defaultModel || currentModel;

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return availableOptions;
    }

    return availableOptions.filter((option) => {
      const haystack = `${option.value} ${option.label || ''} ${option.description || ''}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [availableOptions, query]);

  const activeOption = availableOptions.find((option) => option.value === currentModel);
  const hasConcreteSessionId = typeof currentSessionId === 'string' && currentSessionId.trim().length > 0;

  const copyModel = (model: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(model).catch(() => undefined);
    }
    setCopiedModel(model);
    window.setTimeout(() => {
      setCopiedModel((current) => (current === model ? null : current));
    }, 1300);
  };

  const handleSelectModel = async (model: string) => {
    setChangingModel(model);
    try {
      const result = await onSelectProviderModel(currentProvider, model, currentSessionId);
      if (result.scope === 'session') {
        setPendingSessionModel(result.model);
        setSelectionNotice(t('commandModal.models.nextResponseNotice', { model: result.model }));
        return;
      }

      setPendingSessionModel(null);
      setSelectionNotice(t('commandModal.models.defaultModelNotice', { provider: providerLabel, model: result.model }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('commandModal.models.changeModelError');
      setSelectionNotice(message);
    } finally {
      setChangingModel(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <div className="rounded-2xl border border-border/70 bg-muted/20 p-2.5">
        <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1.55fr)_minmax(12rem,0.7fr)_minmax(15rem,0.9fr)] lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="rounded-lg border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                {providerLabel}
              </Badge>
              <Badge variant="secondary" className="rounded-lg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground">
                {t('commandModal.models.modelCount', { count: availableOptions.length })}
              </Badge>
            </div>

            <div className="mt-2 rounded-xl border border-primary/15 bg-primary/[0.06] px-3 py-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">{t('commandModal.models.activeModel')}</p>
              <p className="mt-1 break-all font-mono text-[0.98rem] font-semibold leading-5 text-foreground sm:text-[1.05rem]">
                {currentModel}
              </p>
              {activeOption?.label && activeOption.label !== currentModel && (
                <p className="mt-1 text-[11px] font-medium text-foreground/85">{activeOption.label}</p>
              )}
              {activeOption?.description && (
                <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{activeOption.description}</p>
              )}
              {pendingSessionModel && pendingSessionModel !== currentModel && (
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
                  {t('commandModal.models.nextResponse', { model: pendingSessionModel })}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-xl border border-border/60 bg-background/55 px-2.5 py-1.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground/80">{t('commandModal.models.default')}</p>
              <p className="mt-1 break-all font-mono text-[11px] font-medium text-foreground">{defaultModel}</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/55 px-2.5 py-1.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground/80">{t('commandModal.models.updated')}</p>
              <p className="mt-1 text-[11px] font-medium text-foreground">{formatUpdatedAt(currentCache?.updatedAt, t('commandModal.models.notCachedYet'))}</p>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/55 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-foreground/80">
                {t('commandModal.models.catalogRefresh')}
              </p>
              <Badge variant="secondary" className="rounded-md px-1.5 py-0 text-[9px] uppercase tracking-[0.14em]">
                {t('commandModal.models.allProviders')}
              </Badge>
            </div>
            <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
              {t('commandModal.models.cacheHint')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onHardRefreshProviderModels}
              disabled={providerModelsRefreshing}
              className="mt-2 h-8 w-full rounded-xl px-3"
            >
              <RefreshCw className={providerModelsRefreshing ? 'animate-spin' : ''} />
              {providerModelsRefreshing ? t('commandModal.models.refreshingCatalogs') : t('commandModal.models.refreshFromProviders')}
            </Button>
          </div>
        </div>

        <div className="mt-2 border-t border-border/50 pt-1.5 text-[11px] text-muted-foreground">
          {hasConcreteSessionId
            ? t('commandModal.models.sessionOverrideHint')
            : t('commandModal.models.defaultModelHint')}
          {selectionNotice && <span className="ml-2 text-foreground">{selectionNotice}</span>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-border/70 bg-muted/15 p-3 sm:p-4">
        <div className="mb-2.5 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="min-w-0">
            <SearchField value={query} onChange={setQuery} placeholder={t('commandModal.models.searchProviderModels', { provider: providerLabel })} />
          </div>
          <Badge variant="secondary" className="h-9 justify-center rounded-xl px-3 font-mono text-xs">
            {t('commandModal.models.shownCount', { count: filteredOptions.length })}
          </Badge>
        </div>

        {filteredOptions.length > 0 ? (
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="grid gap-2 md:grid-cols-2">
              {filteredOptions.map((option, index) => {
                const isCurrent = option.value === currentModel;
                const wasCopied = copiedModel === option.value;
                const isPendingSelection = option.value === pendingSessionModel;
                const isChanging = option.value === changingModel;
                return (
                  <div
                    key={option.value}
                    className={`settings-content-enter group flex min-h-[4.5rem] items-start gap-3 rounded-2xl border p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
                      isCurrent
                        ? 'border-primary/45 bg-primary/10'
                        : isPendingSelection
                          ? 'border-emerald-500/35 bg-emerald-500/10'
                          : 'border-border/70 bg-background/80 hover:border-primary/30 hover:bg-background'
                    }`}
                    style={{ animationDelay: `${Math.min(index * 14, 180)}ms` }}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectModel(option.value)}
                      disabled={Boolean(changingModel)}
                      className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t('commandModal.models.useModel', { model: option.value })}
                    >
                      <span className="flex items-center gap-2">
                        <span className="break-all font-mono text-sm font-semibold text-foreground">{option.value}</span>
                        {isCurrent && <BadgeCheck className="h-4 w-4 shrink-0 text-primary" />}
                      </span>
                      {option.label && option.label !== option.value && (
                        <span className="mt-1 block text-xs text-muted-foreground">{option.label}</span>
                      )}
                      {option.description && (
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span>
                      )}
                      {isCurrent && <span className="mt-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{t('commandModal.models.currentSelection')}</span>}
                      {isPendingSelection && !isCurrent && (
                        <span className="mt-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-400">
                          {t('commandModal.models.nextResponseSelection')}
                        </span>
                      )}
                      {isChanging && (
                        <span className="mt-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                          {t('commandModal.models.applying')}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyModel(option.value)}
                      className="rounded-lg border border-border/70 bg-muted/30 p-2 text-muted-foreground transition-colors group-hover:text-primary"
                      aria-label={t('commandModal.models.copyModelId', { model: option.value })}
                    >
                      {wasCopied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-10 text-center text-sm text-muted-foreground">
            {t('commandModal.models.noModelsMatch')}
          </div>
        )}
      </div>
    </div>
  );
}

function CostContent({ data }: { data: CostCommandData }) {
  const { t } = useTranslation('chat');
  const used = Number(data.tokenUsage?.used ?? 0);
  const total = Number(data.tokenUsage?.total ?? 0);
  const model = data.model || t('commandModal.common.unknown');
  const provider = getProviderLabel(data.provider, data.provider || t('commandModal.common.unknown'));
  const hasBreakdown =
    typeof data.tokenBreakdown?.input === 'number' ||
    typeof data.tokenBreakdown?.output === 'number';
  const usageRows = [
    { label: t('commandModal.cost.totalTokensUsed'), value: formatNumber(used), icon: Activity },
    ...(hasBreakdown
      ? [
          {
            label: t('commandModal.cost.inputTokens'),
            value: formatNumber(Number(data.tokenBreakdown?.input ?? 0)),
            icon: TerminalSquare,
          },
          {
            label: t('commandModal.cost.outputTokens'),
            value: formatNumber(Number(data.tokenBreakdown?.output ?? 0)),
            icon: Coins,
          },
        ]
      : [
          {
            label: t('commandModal.cost.breakdown'),
            value: t('commandModal.common.unavailable'),
            icon: TerminalSquare,
          },
        ]),
    ...(total > 0
      ? [{ label: t('commandModal.cost.contextWindow'), value: formatNumber(total), icon: Gauge }]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/75">
        {usageRows.map((row) => {
          const Icon = row.icon;

          return (
            <div
              key={row.label}
              className="flex items-center justify-between gap-4 border-b border-border/60 px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="truncate text-sm font-medium text-foreground">{row.label}</span>
              </div>
              <span className="shrink-0 font-mono text-sm font-semibold text-foreground">{row.value}</span>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('commandModal.common.provider')}</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{provider}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t('commandModal.common.model')}</p>
            <p className="mt-1 break-all font-mono text-sm text-foreground">{model}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusContent({ data }: { data: StatusCommandData }) {
  const { t } = useTranslation('chat');
  const memoryRssMb = data.memoryUsage?.rssMb;
  const rows = [
    { label: t('commandModal.status.package'), value: data.packageName || 'claude-code-ui', icon: Package },
    { label: t('commandModal.status.version'), value: data.version || t('commandModal.common.unknown'), icon: BadgeCheck, tone: 'success' as const },
    { label: t('commandModal.status.uptime'), value: data.uptime || t('commandModal.common.unknown'), icon: Timer },
    { label: t('commandModal.common.provider'), value: getProviderLabel(data.provider, data.provider || t('commandModal.common.unknown')), icon: Server, tone: 'primary' as const },
    { label: t('commandModal.common.model'), value: data.model || t('commandModal.common.unknown'), icon: Cpu },
    { label: 'Node.js', value: data.nodeVersion || t('commandModal.common.unknown'), icon: TerminalSquare },
    { label: t('commandModal.status.platform'), value: data.platform || t('commandModal.common.unknown'), icon: Activity },
    { label: t('commandModal.status.memory'), value: typeof memoryRssMb === 'number' ? `${memoryRssMb} MB RSS` : t('commandModal.common.unknown'), icon: Gauge },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-3xl border border-emerald-500/25 bg-emerald-500/10 p-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">{t('commandModal.status.runtimeOnline')}</p>
            <p className="text-xs text-muted-foreground">{t('commandModal.status.processResponding', { process: data.pid ? `#${data.pid}` : t('commandModal.status.statusProcess') })}</p>
          </div>
        </div>
        <Badge className="rounded-full bg-emerald-500 text-white hover:bg-emerald-500">{t('commandModal.status.healthy')}</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((row) => (
          <MetricCard key={row.label} label={row.label} value={String(row.value)} icon={row.icon} tone={row.tone} />
        ))}
      </div>
    </div>
  );
}

export default function CommandResultModal({
  payload,
  onClose,
  providerModelCatalog,
  providerModelCacheCatalog,
  providerModelsRefreshing,
  onHardRefreshProviderModels,
  currentSessionId,
  onSelectProviderModel,
}: CommandResultModalProps) {
  const { t } = useTranslation('chat');
  const isOpen = Boolean(payload);
  const kind = payload?.kind;
  const isModelsModal = kind === 'models';

  const modalMeta = {
    help: {
      eyebrow: t('commandModal.meta.help.eyebrow'),
      title: t('commandModal.meta.help.title'),
      subtitle: t('commandModal.meta.help.subtitle'),
      icon: CircleHelp,
    },
    models: {
      eyebrow: t('commandModal.meta.models.eyebrow'),
      title: t('commandModal.meta.models.title'),
      subtitle: t('commandModal.meta.models.subtitle'),
      icon: Cpu,
    },
    cost: {
      eyebrow: t('commandModal.meta.cost.eyebrow'),
      title: t('commandModal.meta.cost.title'),
      subtitle: t('commandModal.meta.cost.subtitle'),
      icon: Coins,
    },
    status: {
      eyebrow: t('commandModal.meta.status.eyebrow'),
      title: t('commandModal.meta.status.title'),
      subtitle: t('commandModal.meta.status.subtitle'),
      icon: Activity,
    },
  } as const;

  const activeMeta = kind ? modalMeta[kind] : null;
  const HeaderIcon = activeMeta?.icon || Sparkles;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(92dvh,48rem)] w-[calc(100vw-1rem)] max-w-5xl flex-col overflow-hidden rounded-3xl border-border/80 bg-popover/95 p-0 shadow-2xl backdrop-blur-xl sm:w-[min(94vw,64rem)]">
        <DialogTitle>{activeMeta?.title || t('commandModal.meta.commandResult')}</DialogTitle>

        <div
          className={`relative shrink-0 overflow-hidden border-b border-border/70 bg-gradient-to-br from-primary/15 via-background to-muted/40 ${
            isModelsModal ? 'px-4 pb-3 pt-3 sm:px-5 sm:pb-4 sm:pt-4' : 'px-4 pb-4 pt-4 sm:px-6 sm:pb-5 sm:pt-5'
          }`}
        >
          <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-primary/20 blur-3xl" />
          <div className="pointer-events-none absolute right-0 top-0 h-full w-1/2 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.16),transparent_58%)]" />

          <div className="relative flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3 sm:items-center">
              <div
                className={`rounded-2xl border border-primary/30 bg-primary/10 text-primary shadow-sm ${
                  isModelsModal ? 'p-2.5' : 'p-3'
                }`}
              >
                <HeaderIcon className={isModelsModal ? 'h-4 w-4' : 'h-5 w-5'} />
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-bold uppercase tracking-[0.22em] text-primary">
                  {activeMeta?.eyebrow}
                </p>
                <p className={`mt-1 font-semibold tracking-tight text-foreground ${isModelsModal ? 'text-xl sm:text-2xl' : 'text-xl sm:text-2xl'}`}>
                  {activeMeta?.title}
                </p>
                <p className={`mt-1 max-w-2xl ${isModelsModal ? 'text-sm leading-5 text-foreground/75' : 'text-sm leading-5 text-muted-foreground'}`}>
                  {activeMeta?.subtitle}
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:bg-background/70 hover:text-foreground"
              aria-label={t('commandModal.closeAria')}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="settings-content-enter min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
          {payload?.kind === 'help' && <HelpContent data={payload.data as HelpCommandData} />}
          {payload?.kind === 'models' && (
            <ModelsContent
              data={payload.data as ModelCommandData}
              providerModelCatalog={providerModelCatalog}
              providerModelCacheCatalog={providerModelCacheCatalog}
              providerModelsRefreshing={providerModelsRefreshing}
              onHardRefreshProviderModels={onHardRefreshProviderModels}
              currentSessionId={currentSessionId}
              onSelectProviderModel={onSelectProviderModel}
            />
          )}
          {payload?.kind === 'cost' && <CostContent data={payload.data as CostCommandData} />}
          {payload?.kind === 'status' && <StatusContent data={payload.data as StatusCommandData} />}
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-border/70 bg-muted/20 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5" />
            <span>{t('commandModal.escCloses')}</span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose} className="rounded-xl">
            {t('commandModal.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
