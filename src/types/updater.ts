/** main → renderer 通过 IPC 'updater:state' 推送的更新状态。 */
export type UpdaterState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotesUrl?: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded' }
  | { state: 'error'; message: string };

/** preload 暴露给 renderer 的 window.updater 形状。 */
export interface UpdaterApi {
  check: () => Promise<void>;
  download: () => Promise<void>;
  quitInstall: () => Promise<void>;
  onState: (fn: (s: UpdaterState) => void) => () => void;
}
