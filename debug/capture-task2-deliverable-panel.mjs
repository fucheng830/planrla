// task #2 截图留证:playwright 无头脚本真实打开页面,验证 DeliverablePanel
// 能渲染 DELIVERY.md 引用的仓库内截图(local-image 代理),并截图留证。
// 前置:node debug/task2-e2e-fixture.mjs 已跑;fixture server(3111,托管 vite build 产物)已起。
// 用法:node debug/capture-task2-deliverable-panel.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve, dirname } from 'node:path';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const worktreeRoot = resolve(here, '..');
const shotDir = join(worktreeRoot, 'debug', 'ui-acceptance');
mkdirSync(shotDir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://localhost:3111';
// fixture server 首次启动会自动创建默认用户 planrla/planrla(见 server 日志)
const USER = process.env.E2E_USER || 'planrla';
const PASS = process.env.E2E_PASS || 'planrla';

const log = (...a) => console.log('[capture]', ...a);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(60000);

try {
  // --- API 登录拿 token,注入 localStorage(绕过登录表单的 UI 等待不确定性) ---
  const loginRes = await page.request.post(`${BASE}/api/auth/login`, {
    data: { username: USER, password: PASS },
  });
  if (!loginRes.ok()) throw new Error(`login failed: ${loginRes.status()} ${await loginRes.text()}`);
  const { token } = await loginRes.json();
  log('api login ok, token acquired');
  await page.addInitScript(([t]) => localStorage.setItem('auth-token', t), [token]);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  log('app loaded');

  // --- 新库首次使用会进 onboarding 向导:走完 Git 配置 + Complete Setup ---
  const gitName = page.getByPlaceholder('你的姓名');
  if (await gitName.count()) {
    log('onboarding: filling git identity');
    await gitName.fill('fixture');
    await page.getByPlaceholder('你的邮箱').fill('fixture@local');
    await page.getByRole('button', { name: /Next/ }).click();
    const complete = page.getByRole('button', { name: /Complete Setup/ });
    await complete.waitFor({ timeout: 20000 });
    await complete.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    log('onboarding finished');
  }

  // --- 进入挂载 fixture 任务的真实扫描项目(workbench)---
  const proj = page.getByText('电脑维护').first();
  await proj.waitFor({ timeout: 30000 });
  await proj.click();
  await page.waitForLoadState('networkidle').catch(() => {});
  log('entered project workbench');

  // --- 切到「研发流程」tab ---
  const tab = page.getByText('研发流程', { exact: true }).first();
  await tab.waitFor({ timeout: 30000 });
  await tab.click();
  log('switched to workflow tab');

  // --- 打开 success 任务的交付物面板 ---
  const showBtn = page.getByRole('button', { name: /查看交付物/ }).first();
  await showBtn.waitFor({ timeout: 30000 });
  await showBtn.click();
  log('deliverable panel opened');

  // --- 断言:DELIVERY.md 的截图以 <img> 渲染且真实加载成功(local-image 代理) ---
  const img = page.locator('img[src*="/api/providers/local-image"]').first();
  await img.waitFor({ timeout: 20000 });
  const src = await img.getAttribute('src');
  const loaded = await img.evaluate((el) => el.complete && el.naturalWidth > 0 && el.naturalHeight > 0);
  if (!loaded) throw new Error(`screenshot image failed to load: ${src}`);
  log('evidence image loaded via proxy:', decodeURIComponent(src));

  // --- 留证截图:面板特写 + 整页 ---
  await page.waitForTimeout(500);
  const panel = page.locator('.ds-panel').first();
  await panel.screenshot({ path: join(shotDir, 'task2-deliverable-panel.png') });
  await page.screenshot({ path: join(shotDir, 'task2-workflow-fullpage.png'), fullPage: false });
  log('saved:', join(shotDir, 'task2-deliverable-panel.png'));
  log('saved:', join(shotDir, 'task2-workflow-fullpage.png'));
  console.log('CAPTURE_OK');
} finally {
  await browser.close();
}
