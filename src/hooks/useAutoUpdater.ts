import { useEffect, useState } from 'react';
import type { UpdaterState } from '../types/updater';

const IDLE: UpdaterState = { state: 'idle' };

/**
 * 订阅 electron-updater 状态(经 preload 桥)。仅在 packaged 桌面模式有意义:
 * window.updater 由 preload.cjs 注入,isPackaged=false 时不存在。
 */
export const useAutoUpdater = () => {
  const [state, setState] = useState<UpdaterState>(IDLE);

  useEffect(() => {
    if (!window.updater) return;
    const unsubscribe = window.updater.onState(setState);
    return unsubscribe;
  }, []);

  return {
    state,
    check: () => window.updater?.check(),
    download: () => window.updater?.download(),
    quitInstall: () => window.updater?.quitInstall(),
  };
};
