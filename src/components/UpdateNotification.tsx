import type { UpdaterState } from '../types/updater';
import { getNotificationContent } from './updateNotificationContent';

interface Props {
  state: UpdaterState;
  onDownload: () => void;
  onQuitInstall: () => void;
  onClose: () => void;
}

/**
 * 桌面端更新通知卡片(右下角浮层)。消费 UpdaterState,渲染由
 * getNotificationContent 决定的内容。Task 6 会把它挂到根布局。REQ-011。
 */
export const UpdateNotification = ({ state, onDownload, onQuitInstall, onClose }: Props) => {
  const content = getNotificationContent(state);
  if (!content) return null;

  // 主按钮类型决定回调:quit-install 走重启安装,其余(download/重试)走下载。
  const onPrimary = content.primaryAction?.type === 'quit-install' ? onQuitInstall : onDownload;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-lg text-slate-100">
      <div className="mb-2">{content.title}</div>
      {content.progressPercent !== undefined && (
        <div className="mb-2 h-1.5 w-full rounded bg-slate-700">
          <div
            className="h-1.5 rounded bg-primary"
            style={{ width: `${content.progressPercent}%` }}
          />
        </div>
      )}
      {content.primaryAction && (
        <button
          type="button"
          onClick={onPrimary}
          className="mr-2 rounded bg-primary px-3 py-1 text-sm hover:bg-primary/90"
        >
          {content.primaryAction.label}
        </button>
      )}
      {content.secondaryAction && (
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-slate-600 px-3 py-1 text-sm hover:bg-slate-800"
        >
          {content.secondaryAction.label}
        </button>
      )}
    </div>
  );
};
