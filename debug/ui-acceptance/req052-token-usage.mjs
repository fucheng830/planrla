// debug/ui-acceptance/req052-token-usage.mjs
//
// REQ-052 UI 验收(playwright 无头):针对真实打包的 TokenUsageSummary 组件
// (req052-harness.tsx),断言:
//   A. hover ≥150ms → 详情卡片出现,含 已用/输入/输出/可见消息/上下文占用 + 压缩提示
//   B. hover <150ms 移开 → 不出现
//   C. 移开 → 卡片消失
//   D. 点击 → onCompact 触发;compacting 场景 → 按钮禁用 + spinner + 卡片文案
//   E. unsupported / empty 场景 → 对应文案 + 点击不触发 onCompact
// 截图留存 debug/ui-acceptance/req052-*.png。
//
// 用法: node debug/ui-acceptance/req052-token-usage.mjs
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const htmlUrl = pathToFileURL(resolve('debug/ui-acceptance/req052-harness.html')).href;
mkdirSync('debug/ui-acceptance', { recursive: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
await page.goto(htmlUrl);
await page.waitForSelector('button[aria-label]');

const button = page.locator('button[aria-label]').first();
const card = page.locator('[role="tooltip"]');
const moveAway = async () => page.mouse.move(20, 20);

// --- A. hover ≥150ms → popover 出现,数据行 + 提示文案齐全 ---
await button.hover();
await page.waitForSelector('[role="tooltip"]', { state: 'visible', timeout: 3000 });
const cardText = await card.innerText();
for (const expected of [
  '上下文用量', '已用令牌', '输入', '输出', '可见消息', '上下文窗口占用',
  '点击按钮即可压缩上下文', '118,000', '102,000', '16,000', '42 / 87', '74%',
]) {
  check(`popover 含「${expected}」`, cardText.includes(expected));
}
// 进度条存在且宽度反映占用
const barWidth = await card.locator('.rounded-full.bg-primary').first().evaluate((el) => el.style.width);
check('上下文占用进度条 74%', barWidth === '74%', `width=${barWidth}`);
await page.screenshot({ path: 'debug/ui-acceptance/req052-popover.png' });

// --- B. hover <150ms 移开 → 不出现 ---
await moveAway();
await page.waitForTimeout(300);
await page.mouse.move(700, 500); // 接近按钮但不停留
await moveAway();
const quickVisible = await card.isVisible();
check('hover <150ms 移开不出现', !quickVisible);

// --- C. 移开 → 卡片消失 ---
await button.hover();
await page.waitForSelector('[role="tooltip"]', { state: 'visible' });
await moveAway();
await page.waitForTimeout(200);
check('移开后卡片消失', !(await card.isVisible()));

// --- D. 点击 → onCompact 触发;compacting 场景 loading 态 ---
await button.hover();
await page.waitForSelector('[role="tooltip"]', { state: 'visible' });
await button.click();
const callsAfterClick = await page.evaluate(() => window.__compactCalls);
check('点击触发 onCompact', callsAfterClick === 1, `calls=${callsAfterClick}`);

await page.evaluate(() => window.__setScenario('compacting'));
await page.waitForTimeout(150);
check('压缩中按钮 disabled', await button.isDisabled());
check('压缩中显示 spinner', await button.locator('.animate-spin').count() === 1);
const compactingCardText = await card.innerText();
check('卡片显示「正在压缩上下文…」', compactingCardText.includes('正在压缩上下文…'));
await page.screenshot({ path: 'debug/ui-acceptance/req052-compacting.png' });

// 压缩中再点击不重复触发
await button.click({ force: true }).catch(() => {});
const callsAfterDisabledClick = await page.evaluate(() => window.__compactCalls);
check('压缩中点击不重复触发', callsAfterDisabledClick === 1, `calls=${callsAfterDisabledClick}`);

// --- E1. unsupported 场景 ---
await page.evaluate(() => window.__setScenario('unsupported'));
await page.waitForTimeout(150);
check('unsupported 按钮不禁用(悬停仍可看详情)', !(await button.isDisabled()));
await moveAway();
await button.hover();
await page.waitForSelector('[role="tooltip"]', { state: 'visible' });
const unsupportedText = await card.innerText();
check('卡片显示「暂不支持」', unsupportedText.includes('暂不支持'));
await button.click();
const callsUnsupported = await page.evaluate(() => window.__compactCalls);
check('unsupported 点击不触发 onCompact', callsUnsupported === 1, `calls=${callsUnsupported}`);
await page.screenshot({ path: 'debug/ui-acceptance/req052-unsupported.png' });

// --- E2. empty 场景 ---
await page.evaluate(() => window.__setScenario('empty'));
await page.waitForTimeout(150);
await moveAway();
await button.hover();
await page.waitForSelector('[role="tooltip"]', { state: 'visible' });
const emptyText = await card.innerText();
check('空会话显示「暂无可压缩的会话内容」', emptyText.includes('暂无可压缩的会话内容'));
await button.click();
const callsEmpty = await page.evaluate(() => window.__compactCalls);
check('空会话点击不触发 onCompact', callsEmpty === 1, `calls=${callsEmpty}`);

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n===== REQ-052 UI ACCEPTANCE: ${results.length - failed.length}/${results.length} passed =====`);
process.exit(failed.length > 0 ? 1 : 0);
