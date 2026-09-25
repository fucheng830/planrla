import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatInterface } from '@planrla/chat';
import FileRefContextMenu from '../../chat/view/FileRefContextMenu';
import ExtensionPanel from '../../extension-panel/view/ExtensionPanel';
import { useExtensionPanel } from '../../extension-panel/hooks/useExtensionPanel';
import GitRepositoryModal from '../../git-panel/view/modals/GitRepositoryModal';
import PluginTabContent from '../../plugins/view/PluginTabContent';
import type { MainContentProps } from '../types/types';
import { usePaletteOpsRegister } from '../../../contexts/PaletteOpsContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { authenticatedFetch } from '../../../utils/api';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import EditorSidebar from '../../code-editor/view/EditorSidebar';
import { OverviewPage } from '../../workbench/pages/OverviewPage';
import { InboxPage } from '../../workbench/pages/InboxPage';
import { WorkflowPage } from '../../workbench/pages/WorkflowPage';
import { SchedulePage } from '../../workbench/pages/SchedulePage';

import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
import ErrorBoundary from './ErrorBoundary';

function MainContent({
  selectedProject,
  selectedSession,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  isMobile,
  onMenuClick,
  isLoading,
  onInputFocusChange,
  onSessionProcessing,
  onSessionIdle,
  onSessionCompleted,
  processingSessions,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  externalMessageUpdate,
  newSessionTrigger,
  allPickerSessions,
  projects,
  onForkAtMessage,
  onToggleTerminalPanel,
}: MainContentProps) {
  const { t } = useTranslation();
  const { preferences } = useUiPreferences();
  const { autoExpandTools, showRawParameters, showThinking, autoScrollToBottom, sendByCtrlEnter } = preferences;

  const [browserUseEnabled, setBrowserUseEnabled] = useState(false);
  const {
    isOpen: isExtensionOpen,
    openTabs: extensionTabs,
    activeTabId: extensionActiveTab,
    openTab: openExtensionTab,
    closeTab: closeExtensionTab,
    toggleTab: toggleExtensionTab,
    togglePanel: toggleExtensionPanel,
    closePanel: closeExtensionPanel,
    setActiveTabId: setExtensionActiveTab,
  } = useExtensionPanel();
  const [isGitModalOpen, setIsGitModalOpen] = useState(false);

  const shouldShowBrowserTab = browserUseEnabled;

  const {
    editingFile,
    openFiles,
    activeFilePath,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleCloseFile,
    handleSwitchFile,
    handleToggleEditorExpand,
    handleResizeStart,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  const loadBrowserUseSettings = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/browser-use/settings');
      const data = await response.json();
      setBrowserUseEnabled(Boolean(response.ok && data?.success !== false && data?.data?.settings?.enabled));
    } catch {
      setBrowserUseEnabled(false);
    }
  }, []);

  useEffect(() => {
    void loadBrowserUseSettings();
    window.addEventListener('browserUseSettingsChanged', loadBrowserUseSettings);
    return () => window.removeEventListener('browserUseSettingsChanged', loadBrowserUseSettings);
  }, [loadBrowserUseSettings]);

  useEffect(() => {
    if (activeTab === 'git' && selectedProject) {
      setIsGitModalOpen(true);
    }
  }, [activeTab, selectedProject]);

  const handleCloseGitModal = useCallback(() => {
    setIsGitModalOpen(false);
    if (activeTab === 'git') {
      setActiveTab('chat');
    }
  }, [activeTab, setActiveTab]);

  usePaletteOpsRegister({
    openFile: (filePath: string) => {
      // Open in the right-side editor sidebar without switching tabs — the file
      // tree now lives in the left sidebar, so the main area stays on the
      // current tab (usually chat) while the file opens alongside it.
      handleFileOpen(filePath);
    },
  });

  if (isLoading) {
    return <MainContentStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (!selectedProject) {
    return <MainContentStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  return (
    <div className="flex h-full flex-col bg-workbench-canvas">
      <MainContentHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onToggleTerminalPanel={onToggleTerminalPanel}
        onToggleExtension={toggleExtensionPanel}
        isExtensionOpen={isExtensionOpen}
        extensionActiveTab={isExtensionOpen ? extensionActiveTab : null}
        onToggleExtensionTab={toggleExtensionTab}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        shouldShowBrowserTab={shouldShowBrowserTab}
        isMobile={isMobile}
        onMenuClick={onMenuClick}
      />

      {/* REQ-055: chat-wide right-click file actions (delegated, portal menu). */}
      <FileRefContextMenu selectedProject={selectedProject} onOpenInEditor={handleFileOpen}>
      <div className={`flex min-h-0 flex-1 overflow-hidden ${activeTab === 'chat' ? 'bg-white' : 'bg-workbench-canvas'}`}>
        <div className={`flex min-h-0 min-w-[200px] flex-col overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1`}>
          <div className={`h-full ${(activeTab === 'chat' || activeTab === 'files' || activeTab === 'git') ? 'block' : 'hidden'}`}>
            <ErrorBoundary showDetails>
              <ChatInterface
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                ws={ws}
                sendMessage={sendMessage}
                onFileOpen={handleFileOpen}
                onInputFocusChange={onInputFocusChange}
                onSessionProcessing={onSessionProcessing}
                onSessionIdle={onSessionIdle}
                onSessionCompleted={onSessionCompleted}
                processingSessions={processingSessions}
                onNavigateToSession={onNavigateToSession}
                onSessionEstablished={onSessionEstablished}
                onShowSettings={onShowSettings}
                autoExpandTools={autoExpandTools}
                showRawParameters={showRawParameters}
                showThinking={showThinking}
                autoScrollToBottom={autoScrollToBottom}
                sendByCtrlEnter={sendByCtrlEnter}
                externalMessageUpdate={externalMessageUpdate}
                newSessionTrigger={newSessionTrigger}
                allPickerSessions={allPickerSessions}
                onForkAtMessage={onForkAtMessage}
              />
            </ErrorBoundary>
          </div>

          <GitRepositoryModal
            isOpen={isGitModalOpen}
            selectedProject={selectedProject}
            isMobile={isMobile}
            onClose={handleCloseGitModal}
            onFileOpen={handleFileOpen}
          />

          {activeTab.startsWith('plugin:') && (
            <div className="h-full overflow-hidden">
              <PluginTabContent
                pluginName={activeTab.replace('plugin:', '')}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
              />
            </div>
          )}

          {activeTab === 'overview' && (
            <div className="h-full">
              <ErrorBoundary showDetails>
                <OverviewPage
                  project={selectedProject}
                  projects={projects}
                  onOpenWorkflow={() => setActiveTab('workflow')}
                  onOpenInbox={() => setActiveTab('inbox')}
                />
              </ErrorBoundary>
            </div>
          )}

          {activeTab === 'inbox' && (
            <div className="h-full">
              <ErrorBoundary showDetails>
                <InboxPage project={selectedProject} />
              </ErrorBoundary>
            </div>
          )}

          {activeTab === 'workflow' && (
            <div className="h-full">
              <ErrorBoundary showDetails>
                <WorkflowPage projectName={selectedProject.displayName} projects={projects} />
              </ErrorBoundary>
            </div>
          )}

          {activeTab === 'schedule' && (
            <div className="h-full">
              <ErrorBoundary showDetails>
                <SchedulePage
                  projectId={selectedProject.projectId}
                  projectPath={selectedProject.fullPath ?? selectedProject.path ?? ''}
                />
              </ErrorBoundary>
            </div>
          )}

        </div>

        {isExtensionOpen && selectedProject && (
          <ExtensionPanel
            selectedProject={selectedProject}
            onFileOpen={handleFileOpen}
            onShowSettings={onShowSettings}
            openTabs={extensionTabs}
            activeTabId={extensionActiveTab}
            onOpenTab={openExtensionTab}
            onActivateTab={setExtensionActiveTab}
            onCloseTab={closeExtensionTab}
            onClose={closeExtensionPanel}
          />
        )}

        <EditorSidebar
          editingFile={editingFile}
          openFiles={openFiles}
          activeFilePath={activeFilePath}
          isMobile={isMobile}
          editorExpanded={editorExpanded}
          editorWidth={editorWidth}
          hasManualWidth={hasManualWidth}
          resizeHandleRef={resizeHandleRef}
          onResizeStart={handleResizeStart}
          onCloseEditor={handleCloseEditor}
          onCloseFile={handleCloseFile}
          onSwitchFile={handleSwitchFile}
          onToggleEditorExpand={handleToggleEditorExpand}
          projectPath={selectedProject.path}
          fillSpace={false}
        />
      </div>
      </FileRefContextMenu>
    </div>
  );
}

export default React.memo(MainContent);
