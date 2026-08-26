import { Bell, ChevronDown, CircleHelp, Moon, Search, Settings, Sun } from 'lucide-react';
import { toast } from 'sonner';

import { useTheme } from '../../contexts/ThemeContext';

export function MessageHubHeader() {
  const { isDarkMode, toggleDarkMode } = useTheme();

  const handleThemeToggle = () => {
    toggleDarkMode();
    toast.success(isDarkMode ? '已切换到亮色模式' : '已切换到暗色模式');
  };

  return (
    <header className="mh-header">
      <div className="mh-brand-lockup">
        <span className="mh-brand-mark">P</span>
        <span className="mh-brand-name">Planrla</span>
        <span className="mh-header-divider" />
        <span className="mh-product-name">消息协作中枢</span>
        <span className="mh-beta-tag">BETA</span>
      </div>

      <label className="mh-search-field">
        <Search aria-hidden="true" />
        <input aria-label="搜索消息" placeholder="搜索消息、发送方、内容、话题、项目、任务..." />
        <kbd>⌘ K</kbd>
      </label>

      <div className="mh-header-actions">
        <button type="button" className="mh-icon-button" aria-label="通知" onClick={() => toast('暂无新的系统通知')}>
          <Bell />
          <span className="mh-notification-dot" />
        </button>
        <button type="button" className="mh-icon-button" aria-label="帮助" onClick={() => toast('帮助中心即将开放')}><CircleHelp /></button>
        <button type="button" className="mh-icon-button" aria-label="设置" onClick={() => toast('设置面板已准备')}><Settings /></button>
        <button type="button" className="mh-icon-button mh-theme-toggle" aria-label="切换主题" onClick={handleThemeToggle}>
          {isDarkMode ? <Sun /> : <Moon />}
        </button>
        <span className="mh-user-avatar">王</span>
        <span className="mh-user-name">王工</span>
        <ChevronDown className="mh-user-chevron" aria-hidden="true" />
      </div>
    </header>
  );
}
