import { Eye, EyeOff, Network, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '../../../../../../shared/view/ui';
import { useA2aAgentsSettings, type A2aAgentItem } from '../../../../hooks/useA2aAgentsSettings';

export default function A2aAgentsSection() {
  const { t } = useTranslation('settings');

  const {
    agents,
    showNewForm,
    setShowNewForm,
    newName,
    setNewName,
    newUrl,
    setNewUrl,
    newDescription,
    setNewDescription,
    newAuthToken,
    setNewAuthToken,
    showAuthToken,
    createAgent,
    deleteAgent,
    cancelNewForm,
    toggleAuthTokenVisibility,
  } = useA2aAgentsSettings({
    confirmDeleteText: t('a2a.confirmDelete'),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5" />
          <h3 className="text-lg font-semibold">{t('a2a.title')}</h3>
        </div>
        <Button size="sm" onClick={() => setShowNewForm(!showNewForm)}>
          <Plus className="mr-1 h-4 w-4" />
          {t('a2a.addButton')}
        </Button>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">{t('a2a.description')}</p>

      {showNewForm && (
        <div className="mb-4 space-y-3 rounded-lg border bg-card p-4">
          <Input
            placeholder={t('a2a.form.namePlaceholder')}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />

          <Input
            placeholder={t('a2a.form.urlPlaceholder')}
            value={newUrl}
            onChange={(event) => setNewUrl(event.target.value)}
          />

          <Input
            placeholder={t('a2a.form.descriptionPlaceholder')}
            value={newDescription}
            onChange={(event) => setNewDescription(event.target.value)}
          />

          <div className="relative">
            <Input
              type={showAuthToken ? 'text' : 'password'}
              placeholder={t('a2a.form.authTokenPlaceholder')}
              value={newAuthToken}
              onChange={(event) => setNewAuthToken(event.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              onClick={toggleAuthTokenVisibility}
              aria-label={showAuthToken ? 'Hide token' : 'Show token'}
              className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
            >
              {showAuthToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <div className="flex gap-2">
            <Button onClick={createAgent}>{t('a2a.form.addButton')}</Button>
            <Button variant="outline" onClick={cancelNewForm}>
              {t('a2a.form.cancelButton')}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {agents.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">{t('a2a.empty')}</p>
        ) : (
          agents.map((agent: A2aAgentItem) => (
            <div key={agent.id} className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex-1">
                <div className="font-medium">{agent.name}</div>
                <div className="text-xs text-muted-foreground">{agent.url}</div>
                {agent.description && (
                  <div className="text-xs text-muted-foreground">{agent.description}</div>
                )}
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('a2a.added')} {new Date(agent.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => deleteAgent(agent.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
