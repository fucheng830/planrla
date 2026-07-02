// Main 进程主题缓存：renderer 每次主题变化时写入 effectiveDark，
// 启动时 main 读它来选 BrowserWindow.backgroundColor 与 titleBarOverlay 颜色，
// 消除"亮色系统启动瞬间暗色闪屏"。
const fs = require('fs');
const path = require('path');

/** @returns {{ effectiveDark: boolean } | null} */
function readThemeCache(userDataDir) {
  try {
    const p = path.join(userDataDir, 'theme-cache.json');
    if (!fs.existsSync(p)) return null;
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (typeof obj?.effectiveDark === 'boolean') return obj;
    return null;
  } catch {
    return null;
  }
}

/** @param {string} userDataDir @param {boolean} effectiveDark */
function writeThemeCache(userDataDir, effectiveDark) {
  try {
    fs.writeFileSync(
      path.join(userDataDir, 'theme-cache.json'),
      JSON.stringify({ effectiveDark }),
    );
  } catch (e) {
    console.error('[desktop:themeCache] write failed:', e?.message);
  }
}

module.exports = { readThemeCache, writeThemeCache };
