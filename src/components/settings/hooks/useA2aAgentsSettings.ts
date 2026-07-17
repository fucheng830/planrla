import { useCallback, useEffect, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';

export type A2aAgentItem = {
  id: number;
  name: string;
  url: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
};

type CreateA2aAgentResponse = { id?: number; error?: string };
type DeleteA2aAgentResponse = { ok?: boolean; error?: string };

type UseA2aAgentsSettingsArgs = {
  confirmDeleteText: string;
};

const getApiError = (payload: { error?: string } | undefined, fallback: string) => (
  payload?.error || fallback
);

export function useA2aAgentsSettings({ confirmDeleteText }: UseA2aAgentsSettingsArgs) {
  const [agents, setAgents] = useState<A2aAgentItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newAuthToken, setNewAuthToken] = useState('');
  const [showAuthToken, setShowAuthToken] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await authenticatedFetch('/api/settings/a2a-agents');
      const payload = await response.json() as A2aAgentItem[];
      setAgents(Array.isArray(payload) ? payload : []);
    } catch (error) {
      console.error('Error fetching A2A agents:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const createAgent = useCallback(async () => {
    if (!newName.trim() || !newUrl.trim()) {
      return;
    }

    try {
      const response = await authenticatedFetch('/api/settings/a2a-agents', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          url: newUrl.trim(),
          description: newDescription.trim(),
          authToken: newAuthToken,
        }),
      });

      const payload = await response.json() as CreateA2aAgentResponse;
      if (!response.ok) {
        console.error('Error creating A2A agent:', getApiError(payload, 'Failed to create A2A agent'));
        return;
      }

      setNewName('');
      setNewUrl('');
      setNewDescription('');
      setNewAuthToken('');
      setShowNewForm(false);
      setShowAuthToken(false);
      await fetchData();
    } catch (error) {
      console.error('Error creating A2A agent:', error);
    }
  }, [fetchData, newAuthToken, newDescription, newName, newUrl]);

  const deleteAgent = useCallback(async (agentId: number) => {
    if (!window.confirm(confirmDeleteText)) {
      return;
    }

    try {
      const response = await authenticatedFetch(`/api/settings/a2a-agents/${agentId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const payload = await response.json() as DeleteA2aAgentResponse;
        console.error('Error deleting A2A agent:', getApiError(payload, 'Failed to delete A2A agent'));
        return;
      }

      await fetchData();
    } catch (error) {
      console.error('Error deleting A2A agent:', error);
    }
  }, [confirmDeleteText, fetchData]);

  const cancelNewForm = useCallback(() => {
    setShowNewForm(false);
    setNewName('');
    setNewUrl('');
    setNewDescription('');
    setNewAuthToken('');
    setShowAuthToken(false);
  }, []);

  const toggleAuthTokenVisibility = useCallback(() => {
    setShowAuthToken((prev) => !prev);
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return {
    agents,
    loading,
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
  };
}
