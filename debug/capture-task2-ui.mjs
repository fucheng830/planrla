// kanban task #2 可视化验证:无头 playwright 真实打开页面截图留证。
// 复跑方式:先起 dev(server 3210 + vite 5180),再 node debug/capture-task2-ui.mjs
// 前置:debug/.capture-token(本地 JWT,临时文件,不入库)
// 产出:debug/ui-acceptance/task2-*.png
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const token = readFileSync(join(here, '.capture-token'), 'utf8').trim();
const BASE = process.env.CAPTURE_BASE || 'http://localhost:5180';
const OUT = join(here, 'ui-acceptance');
// 任务 #1(REQ-052,success)真实现场:worktree 里已有 ui-acceptance 截图。
const DELIVERY = 'C:/workspace/项目/planrla/.worktree/kanban/1-f81b6189/DELIVERY.md';

const evidence = [
  '',
  '',
  '## 验证证据(临时注入,capture 脚本结束后自动还原)',
  '',
  '![悬浮气泡 hover 详情](debug/ui-acceptance/req052-popover.png)',
  '',
].join('\n');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript((t) => localStorage.setItem('auth-token', t), token);

const original = readFileSync(DELIVERY, 'utf8');
try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // 左侧 rail(纯图标,aria-label 即名称)→「研发流程」视图
  await page.getByRole('button', { name: '研发流程' }).first().click({ timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT, 'task2-workflow-page.png') });

  // 任务 #1 卡片:success 任务显示「查看交付物」
  const showBtn = page.getByRole('button', { name: '查看交付物' }).first();
  await showBtn.waitFor({ state: 'visible', timeout: 15000 });
  await showBtn.click();
  await page.waitForTimeout(1500);
  // 交付面板:DELIVERY.md 为表格文字引用 → 文字原样,不渲染图片(不误伤)
  await page.screenshot({ path: join(OUT, 'task2-delivery-panel-table-ref.png') });

  // 注入图片语法 → 重开面板 → 应渲染出 worktree 内截图
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
  // 滚动到图片本体再拍,证据更直观
  await page.evaluate(() => document.querySelector('.ds-panel img')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, 'task2-delivery-panel-image.png') });
  await page.getByRole('button', { name: '关闭' }).first().click();

  // best-effort:模板编辑器(KanbanPanel「模板」按钮,若当前视图可达)
  try {
    const tplBtn = page.getByRole('button', { name: /模板/ }).first();
    await tplBtn.click({ timeout: 5000 });
    await page.waitForTimeout(1500);
    const ss3Text = page.getByText('可视化验证要求', { exact: false }).first();
    await ss3Text.waitFor({ state: 'visible', timeout: 10000 });
    await page.screenshot({ path: join(OUT, 'task2-template-ss3-prompt.png'), fullPage: false });
    console.log('template editor captured');
  } catch {
    console.log('template editor not reachable from this view (skipped)');
  }

  console.log('CAPTURE OK');
} finally {
  writeFileSync(DELIVERY, original);
  await browser.close();
}
