/**
 * 桌面端自绘标题栏（仅 Electron，非 macOS）。方案 A：系统按钮原生，容器自绘。
 *  - 顶部 40px (h-10)，与 electron/main.js titleBarOverlay.height 对齐
 *  - 整条 drag（移动窗口）；内部交互元素需标 no-drag（当前无）
 *  - 背景用 bg-background token 跟主题；右侧用 CSS env 避让系统按钮区
 *  - macOS 不渲染（hiddenInset 保留原生 traffic lights）
 */
export default function TitleBar() {
  if (typeof window === 'undefined' || !window.electronAPI) return null;
  if (window.electronAPI.platform === 'darwin') return null; // mac 保留原生 traffic lights

  return (
    <div
      className="flex h-10 items-center justify-between bg-background select-none"
      style={{ WebkitAppRegion: 'drag', paddingRight: 'env(titlebar-area-x, 138px)' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 pl-3">
        <span className="text-sm font-semibold text-foreground">Planrla</span>
      </div>
    </div>
  );
}
