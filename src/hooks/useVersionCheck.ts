import { useState, useEffect } from 'react';
import { version } from '../../package.json';
import { ReleaseInfo } from '../types/sharedTypes';

/**
 * Compare two semantic version strings
 * Works only with numeric versions separated by dots (e.g. "1.2.3")
 * @param {string} v1
 * @param {string} v2
 * @returns positive if v1 > v2, negative if v1 < v2, 0 if equal
 */
const compareVersions = (v1: string, v2: string) => {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 !== p2) return p1 - p2;
  }
  return 0;
};

/**
 * 是否需要提示「重启服务器」。
 * 打包桌面模式(app.isPackaged)下永远 false —— Electron 每次启动都重启 server,
 * 不存在 server 跑旧代码的场景;仅 npm/git 源码模式自更新后提示。
 *
 * 抽成纯函数便于单测(见 useVersionCheck.test.ts)。REQ-010。
 */
export const computeRestartRequired = (
  isPackaged: boolean,
  serverVersion: string | null,
  bundleVersion: string
): boolean => {
  if (isPackaged) return false;
  if (typeof serverVersion !== 'string' || serverVersion.length === 0) return false;
  return serverVersion !== bundleVersion;
};

export type InstallMode = 'git' | 'npm';

export const useVersionCheck = (_owner?: string, _repo?: string) => {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null);
  const [installMode, setInstallMode] = useState<InstallMode>('git');
  const [runningVersion, setRunningVersion] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await fetch('/health');
        const data = await response.json();
        if (data.installMode === 'npm' || data.installMode === 'git') {
          setInstallMode(data.installMode);
        }
        // `data.version` is the version the server process is actually running.
        // This module's `version` is baked into the frontend bundle at build
        // time, so it reflects the installed (on-disk) package. If they differ
        // (and we're not in a packaged desktop app), the package was updated
        // but the server process was not restarted, and DB-backed actions may
        // silently fail until it is. Packaged desktop always restarts the
        // server on launch, so the check is skipped there (REQ-010).
        setRunningVersion(
          typeof data.version === 'string' && data.version.length > 0 ? data.version : null
        );
        setRestartRequired(computeRestartRequired(!!data.isPackaged, data.version, version));
      } catch {
        // Default to git / no restart hint on error
      }
    };
    fetchHealth();
  }, []);

  useEffect(() => {
    const checkVersion = async () => {
      try {
        const response = await fetch('/api/version/latest');
        const data = await response.json();

        if (data.version) {
          const latest = String(data.version).replace(/^v/, '');
          setLatestVersion(latest);
          setUpdateAvailable(compareVersions(latest, version) > 0);

          setReleaseInfo({
            title: data.title || data.version,
            body: data.body || '',
            htmlUrl: data.htmlUrl || '',
            publishedAt: data.publishedAt || ''
          });
        } else {
          setUpdateAvailable(false);
          setLatestVersion(null);
          setReleaseInfo(null);
        }
      } catch (error) {
        console.error('Version check failed:', error);
        // On error, don't show update notification
        setUpdateAvailable(false);
        setLatestVersion(null);
        setReleaseInfo(null);
      }
    };

    checkVersion();
    const interval = setInterval(checkVersion, 5 * 60 * 1000); // Check every 5 minutes
    return () => clearInterval(interval);
  }, []);

  return { updateAvailable, latestVersion, currentVersion: version, releaseInfo, installMode, runningVersion, restartRequired };
};
