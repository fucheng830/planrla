/** Screenshot the sidebar-header mockup page (full page + right-click menu state). */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto('file:///' + require('path').resolve('debug/sidebar-header-mockups.html').replace(/\\/g, '/'));
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'debug/mockup-full.png', fullPage: true });

  // scroll demo into view, then right-click a project item
  const item = page.locator('#demo-area .project-item').first();
  await item.scrollIntoViewIfNeeded();
  const box = await item.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'debug/mockup-ctx.png' });
  }
  await browser.close();
  console.log('done');
})().catch((e) => { console.error(e.message); process.exit(1); });
