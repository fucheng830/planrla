import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { AgentProvider } from '../../../../../types/types';
import type { PermissionMode } from '@planrla/chat';
import {
  BYPASS_MODE_BY_PROVIDER,
  getDefaultPermissionModes,
  setDefaultPermissionMode,
} from '../../../../../../../shared/defaults/permissionDefaults';
import { getDefaultModel, setDefaultModel } from '../../../../../../../shared/defaults/modelDefaults';
import SettingsCard from '../../../../SettingsCard';
import SettingsRow from '../../../../SettingsRow';
import SettingsSection from '../../../../SettingsSection';

type DefaultModeContentProps = {
  selectedAgent: AgentProvider;
};

export default function DefaultModeContent({ selectedAgent }: DefaultModeContentProps) {
  const { t } = useTranslation(['settings', 'chat']);
  const provider = selectedAgent;
  // claude/codex/cursor → bypassPermissions; gemini → yolo; opencode → undefined
  const bypass = BYPASS_MODE_BY_PROVIDER[provider];

  const [defaultMode, setDefaultMode] = useState<string>(() =>
    getDefaultPermissionModes()[provider] ?? 'default',
  );
  const [defaultModel, setDefaultModelInput] = useState<string>(() =>
    getDefaultModel(provider) ?? '',
  );

  const onModeChange = (mode: string) => {
    setDefaultMode(mode);
    setDefaultPermissionMode(provider, mode as PermissionMode);
  };

  const onModelChange = (model: string) => {
    setDefaultModelInput(model);
    setDefaultModel(provider, model);
  };

  return (
    <div className="space-y-6 p-4">
      <SettingsSection title={t('settings:defaults.permission.title')}>
        <SettingsCard>
          <SettingsRow
            label={t('settings:defaults.permission.label')}
            description={t('settings:defaults.permission.description')}
          >
            <select
              value={defaultMode}
              onChange={(e) => onModeChange(e.target.value)}
              className="w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground sm:w-48"
            >
              <option value="default">{t('settings:defaults.permission.modeDefault')}</option>
              {bypass && (
                <option value={bypass}>
                  {t('settings:defaults.permission.modeBypass')} ({bypass})
                </option>
              )}
            </select>
          </SettingsRow>
          {defaultMode !== 'default' && (
            <div className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs text-orange-800 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{t('chat:defaults.permission.ackMessage')}</span>
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('settings:defaults.model.title')}>
        <SettingsCard>
          <SettingsRow
            label={t('settings:defaults.model.label')}
            description={t('settings:defaults.model.description')}
          >
            <input
              value={defaultModel}
              onChange={(e) => onModelChange(e.target.value)}
              placeholder={t('settings:defaults.model.placeholder')}
              className="w-full rounded-lg border border-input bg-card p-2.5 text-sm text-foreground sm:w-64"
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
