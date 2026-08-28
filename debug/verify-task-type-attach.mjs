import { chromium } from 'playwright';

// e2e 基律:显式指定目标项目,绝不依赖创建卡的默认选中(默认会随项目列表漂移,
// 2026-08-27 曾默认落到已归档的 C:\Users\HONOR 上,清理读错 root 留下 4 个僵尸任务)。
const TARGET_ROOT_ID = '89a9416b-e593-4862-b720-d4c75bbe2ccf'; // wanxiang 测试项目
const TARGET_NAME = 'wanxiang';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5199', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.evaluate(() => localStorage.setItem('activeTab', 'workbench:workflow'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// open card
await page.locator('button', { hasText: '新建需求' }).first().click();
await page.waitForTimeout(500);

// 显式选择目标项目(搜索名→点击),不依赖默认值
await page.locator('button:has-text("关联项目")').click();
await page.waitForTimeout(300);
await page.locator('input[placeholder*="搜索项目"]').fill(TARGET_NAME);
await page.waitForTimeout(300);
await page.locator('ul li button', { hasText: TARGET_NAME }).first().click();
await page.waitForTimeout(300);

await page.locator('[role="group"][aria-label="任务类型"] button', { hasText: 'Bug 修复' }).last().click();
await page.fill('textarea[placeholder*="Bug 描述"]', '登录页在 iOS Safari 白屏');
await page.setInputFiles('input[type="file"]', 'debug/test-attachment.txt');

const upload = await fetch('/api/tasks/nonexistent/attachments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: 'x', dataB64: 'eA==' }) }).then((r) => r.status).catch(() => -1);
console.log('route exists check(expect non-200):', upload);

await page.locator('.ds-panel button', { hasText: '创建任务' }).last().click();
await page.waitForTimeout(3500);
console.log(JSON.stringify(await page.evaluate(() => ({
  bugChip: document.body.innerText.includes('Bug'),
  cardBadge: [...document.querySelectorAll('article span')].some((s) => s.textContent === 'Bug'),
}))));
const ids = await page.evaluate(async (rootId) => {
  const list = await (await fetch(`/api/tasks?rootId=${encodeURIComponent(rootId)}`)).json();
  return list.tasks.filter((t) => t.input?.includes('iOS Safari')).map((t) => ({ id: t.id, type: t.taskType }));
}, TARGET_ROOT_ID);
console.log('task record:', JSON.stringify(ids));
if (ids.length > 0) {
  const att = await page.evaluate(async (tid) => {
    const res = await fetch(`/api/tasks/${tid}/attachments`);
    const data = await res.json();
    if (!data.attachments?.length) return { dl: 404 };
    const dl = await fetch(data.attachments[0] ? `/api/tasks/${tid}/attachments/${data.attachments[0].id}/download` : '');
    return { count: data.attachments.length, dl: dl.status, body: dl.ok ? await dl.text() : '' };
  }, ids[0].id);
  console.log('attachment roundtrip:', JSON.stringify(att));
}
for (const t of ids) {
  await page.evaluate(async ({ id, rootId }) => {
    await fetch(`/api/tasks/${id}?rootId=${encodeURIComponent(rootId)}`, { method: 'DELETE' });
  }, { id: t.id, rootId: TARGET_ROOT_ID });
}
console.log('cleanup done');
await page.screenshot({ path: 'debug/ui-acceptance/tasktype-bug-flow.png' });
await browser.close();
