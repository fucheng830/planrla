const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:3001/session/01a00b49-1f32-7681-8038-3cae05e05d08', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3500);

  // scroll up to the tool-marker area (the baidu.com user message)
  let found = false;
  for (let i = 0; i < 30; i++) {
    const n = await page.locator('text=baidu.com').count();
    if (n > 0) { found = true; break; }
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, -2500);
    await page.waitForTimeout(400);
  }
  console.log('baidu area found:', found);
  const bodyText = await page.locator('body').innerText();
  console.log('raw marker still visible:', bodyText.includes('[external_agent_tool_call]'));
  await page.screenshot({ path: process.env.TEMP + '/codex-fixed.png', fullPage: false });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
