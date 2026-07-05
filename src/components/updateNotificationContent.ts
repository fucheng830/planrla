import type { UpdaterState } from '../types/updater';

/** 通知卡片主按钮触发的动作类型。 */
export type NotificationActionType = 'download' | 'quit-install' | 'close';

/** 通知卡片内容(纯数据,便于单测)。 */
export interface NotificationContent {
  title: string;
  primaryAction?: { label: string; type: 'download' | 'quit-install' };
  secondaryAction?: { label: string; type: 'close' };
  /** 仅 downloading 状态有值,0-100。 */
  progressPercent?: number;
}

/**
 * 把 UpdaterState 映射成通知卡片内容。返回 null 表示该状态不渲染卡片。
 *
 * 抽成纯函数便于用 node:test 单测(组件渲染本身不测)。REQ-011。
 * - idle / checking / not-available → null
 * - available → 提示新版本,主按钮「下载」,次按钮「稍后」
 * - downloading → 显示进度百分比,无按钮
 * - downloaded → 提示重启安装,主按钮「重启安装」,次按钮「稍后」
 * - error → 提示错误信息,主按钮「重试」(再次下载),次按钮「关闭」
 */
export const getNotificationContent = (state: UpdaterState): NotificationContent | null => {
  switch (state.state) {
    case 'idle':
    case 'checking':
    case 'not-available':
      return null;

    case 'available':
      return {
        title: `新版本 ${state.version} 可用`,
        primaryAction: { label: '下载', type: 'download' },
        secondaryAction: { label: '稍后', type: 'close' }
      };

    case 'downloading':
      return {
        title: `下载中… ${state.percent}%`,
        progressPercent: state.percent
      };

    case 'downloaded':
      return {
        title: '下载完成,重启安装?',
        primaryAction: { label: '重启安装', type: 'quit-install' },
        secondaryAction: { label: '稍后', type: 'close' }
      };

    case 'error':
      return {
        title: `更新失败:${state.message}`,
        primaryAction: { label: '重试', type: 'download' },
        secondaryAction: { label: '关闭', type: 'close' }
      };
  }
};
