/**
 * REQ-052 / kanban task #4 — UI acceptance capture (playwright, headless).
 *
 * Drives the REAL built app served by the isolated server (SERVER_PORT=3101,
 * DATABASE_PATH=debug/e2e-auth.db, seeded by debug/seed-task4-fixtures.mjs):
 *
 *   1. login (default planrla/planrla)
 *   2. open the seeded compacted session
 *   3. assert main viewport shows ONLY post-boundary messages (compact card +
 *      two messages) — pre-boundary epoch text must be absent
 *   4. open the 历史消息查询 archive panel from the compact card, browse
 *      epoch 2 → epoch 1, capture screenshots
 *
 * Screenshots → debug/ui-acceptance/task4-*.png
 * Usage:      node debug/capture-task4-ui-acceptance.mjs [baseUrl]
 * Prereq:     1) isolated server on 3101 with seeded fixtures
 *             2) default user planrla/planrla exists in the e2e DB
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const BASE_URL = process.argv[2] || 'http://127.0.0.1:3101';
const OUT_DIR = path.join(root, 'debug', 'ui-acceptance');

const SESSION_NAME = 'E2E 压缩归档验证';
const PROJECT_NAME = 'E2E-REQ052 压缩归档';
const EPOCH1_TEXT = 'E2E纪元1:这个长对话最初的需求背景讨论';
const EPOCH2_TEXT = 'E2E纪元2:继续';
const ACTIVE_TEXT = '边界后的第一条消息';
const ARCHIVED_REPLY_TEXT = 'E2E纪元1回复:确定采用虚拟边界方案';

fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
const record = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'zh-CN',
});
// Force the zh-CN UI regardless of navigator language detection.
await context.addInitScript(() => {
  window.localStorage.setItem('userLanguage', 'zh-CN');
});

const page = await context.newPage();
const shot = (name) => page.screenshot({ path: path.join(OUT_DIR, name), fullPage: false });

try {
  // ── 1. login (skipped when the single-user app auto-enters the main UI) ──
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  if (await page.locator('#username').isVisible().catch(() => false)) {
    await page.fill('#username', 'planrla');
    await page.fill('#password', 'planrla');
    await page.click('button[type="submit"]');
    await page.waitForSelector('#username', { state: 'detached', timeout: 20000 });
    record('login', true, 'via login form');
  } else {
    record('login', true, 'auto-entered main UI (default single user)');
  }
  await page.waitForTimeout(1500);

  // ── 2. open the seeded session via the /session/:id route ──
  await page.goto(`${BASE_URL}/session/e2e-app-req052`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`text=${ACTIVE_TEXT}`, { timeout: 20000 });
  await page.waitForTimeout(1500); // let markdown/tool bubbles settle
  record('open seeded session', true, '/session/e2e-app-req052');

  // ── 3. main viewport shows only the active (post-boundary) epoch ──
  const bodyText = await page.locator('body').innerText();
  const compactCardVisible = bodyText.includes('上下文已压缩');
  const activeVisible = bodyText.includes(ACTIVE_TEXT);
  const epoch1Leaked = bodyText.includes(EPOCH1_TEXT);
  const epoch2Leaked = bodyText.includes(EPOCH2_TEXT);
  record('main viewport: compact card rendered', compactCardVisible);
  record('main viewport: post-boundary messages rendered', activeVisible);
  record('main viewport: epoch1 content hidden', !epoch1Leaked, epoch1Leaked ? 'LEAKED' : '');
  record('main viewport: epoch2 content hidden', !epoch2Leaked, epoch2Leaked ? 'LEAKED' : '');
  await shot('task4-main-active-view.png');

  // ── 4. archive panel from the compact card entry ──
  // Label is count-less when the active viewport reports archivedMessages=null
  // (counts resolve lazily via the compactions endpoint).
  await page.getByRole('button', { name: /查看更早|查看历史消息/ }).first().click();
  await page.waitForSelector('text=历史消息', { timeout: 15000 });
  await page.waitForSelector(`text=${EPOCH2_TEXT}`, { timeout: 15000 });
  await page.waitForTimeout(800);
  const panelText = await page.locator('body').innerText();
  record('archive panel: default epoch (latest) shows epoch2 content', panelText.includes(EPOCH2_TEXT));
  record('archive panel: closing summary rendered as compact card', panelText.includes('【纪元2摘要】'));
  await shot('task4-archive-panel-latest-epoch.png');

  // ── 5. switch to epoch 1 ──
  await page.getByRole('button', { name: /纪元 1/ }).first().click();
  await page.waitForSelector(`text=${EPOCH1_TEXT}`, { timeout: 15000 });
  await page.waitForTimeout(800);
  const epoch1PanelText = await page.locator('body').innerText();
  record('archive panel: epoch switch shows epoch1 content', epoch1PanelText.includes(EPOCH1_TEXT));
  record('archive panel: epoch1 closing summary present', epoch1PanelText.includes('【纪元1摘要】'));
  await shot('task4-archive-panel-epoch1.png');

  // ── 6. load-earlier is disabled when the epoch is fully loaded (fixture ≤ page size) ──
  const loadEarlier = page.getByRole('button', { name: /加载更早/ }).first();
  const disabled = await loadEarlier.isDisabled().catch(() => null);
  record('archive panel: load-earlier disabled at epoch head', disabled === true, `disabled=${disabled}`);
  await shot('task4-archive-panel-load-earlier-state.png');

  // ── 7. close panel; main view unaffected by archive browsing ──
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const afterClose = await page.locator('body').innerText();
  record('after close: main view intact, archived text still hidden',
    afterClose.includes(ACTIVE_TEXT) && !afterClose.includes(EPOCH1_TEXT) && !afterClose.includes(ARCHIVED_REPLY_TEXT));
  await shot('task4-main-after-archive-close.png');
} catch (error) {
  record('UNEXPECTED FAILURE', false, String(error).slice(0, 300));
  await shot('task4-unexpected-failure.png').catch(() => {});
} finally {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n== ${results.length - failed.length}/${results.length} checks passed ==`);
  fs.writeFileSync(path.join(OUT_DIR, 'task4-check-results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  process.exit(failed.length > 0 ? 1 : 0);
}
