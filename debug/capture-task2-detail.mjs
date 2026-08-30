// kanban task #2 可视化验证(补充镜头):滚动交付物面板到「验证证据」图片处截图。
// 复跑方式同 capture-task2-ui.mjs:起 dev(server 3210 + vite 5180)后 node 本文件。
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const token = readFileSync(join(here, '.capture-token'), 'utf8').trim();
const BASE = process.env.CAPTURE_BASE || 'http://localhost:5180';
const OUT = join(here, 'ui-acceptance');
const DELIVERY = 'C:/workspace/项目/planrla/.worktree/kanban/1-f81b6189/DELIVERY.md';
const evidence = [
  '', '', '## 验证证据(临时注入,capture 脚本结束后自动还原)', '',
  '![悬浮气泡 hover 详情](debug/ui-acceptance/req052-popover.png)', '',
].join('\n');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript((t) => localStorage.setItem('auth-token', t), token);
const original = readFileSync(DELIVERY, 'utf8');
try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: '研发流程' }).first().click({ timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: '查看交付物' }).first().click({ timeout: 15000 });
  await page.waitForTimeout(1500);
  writeFileSync(DELIVERY, original + evidence);
  await page.getByRole('button', { name: '关闭' }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '查看交付物' }).first().click();
  const img = page.locator('.ds-panel img').first();
  await img.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => {
    const i = document.querySelector('.ds-panel img');
    return i && i.complete && i.naturalWidth > 0;
  }, { timeout: 15000 });
  await img.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'task2-delivery-evidence-image.png') });
  console.log('DETAIL CAPTURE OK');
} finally {
  writeFileSync(DELIVERY, original);
  await browser.close();
}
