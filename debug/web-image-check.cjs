const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const dbPath = path.join(process.env.USERPROFILE || process.env.HOME, '.planrla', 'auth.db');
const screenshotPath = path.join(os.tmpdir(), 'planrla-image-check.png');
const failureScreenshotPath = path.join(os.tmpdir(), 'planrla-image-check-failure.png');

function generateToken() {
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("SELECT value FROM app_config WHERE key='jwt_secret'").get();
  if (!row || !row.value) throw new Error('no jwt_secret in app_config');
  const user = db.prepare("SELECT id, username FROM users WHERE id=1").get();
  if (!user) throw new Error('no user id=1');
  const token = jwt.sign({ userId: user.id, username: user.username }, row.value, { expiresIn: '7d' });
  db.close();
  return token;
}

let page;

(async () => {
  const token = generateToken();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();

  page.on('console', (msg) => console.log('[PAGE]', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.error('[PAGE ERROR]', err.message));
  page.on('response', (res) => {
    if (res.status() >= 400) {
      console.log('[HTTP]', res.status(), res.url());
    }
  });

  // Use an existing PNG so the rendered image has a visible size
  const imagePath = path.join(__dirname, '..', 'public', 'favicon.png');

  console.log('Opening app...');
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 60000 });

  // Inject auth token and reload so the app recognizes the session
  console.log('Injecting auth token...');
  await page.evaluate((t) => {
    localStorage.setItem('auth-token', t);
    location.reload();
  }, token);
  await page.waitForLoadState('networkidle', { timeout: 60000 });

  // Wait for project list and expand the "项目" project
  console.log('Selecting project...');
  const projectRow = page.getByText('C:\\workspace\\项目').first();
  await projectRow.waitFor({ state: 'visible', timeout: 60000 });
  await projectRow.click();

  // Open a new session for this project
  console.log('Creating new session...');
  const newSessionButton = page.getByText('新会话').first();
  await newSessionButton.waitFor({ state: 'visible', timeout: 10000 });
  await newSessionButton.click();

  // Wait for composer textarea
  console.log('Waiting for composer...');
  const textarea = page.locator('[data-slot="prompt-input-textarea"]').first();
  await textarea.waitFor({ state: 'visible', timeout: 60000 });

  // Attach image via hidden file input inside composer
  console.log('Attaching image...');
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(imagePath);

  // Wait for preview thumbnail to appear (confirms attachment)
  await page.waitForSelector('img[src^="blob:"]', { timeout: 10000 });

  // Type message and send
  await textarea.fill('web image check');
  await textarea.press('Enter');

  // Wait for the sent message to render with the base64 image
  console.log('Waiting for sent image to appear in chat...');
  const chatImage = page.locator('img[src^="data:image"]').first();
  await chatImage.waitFor({ state: 'visible', timeout: 15000 });

  // Verify it has non-zero bounding box
  const box = await chatImage.boundingBox();
  console.log('Chat image bounding box:', box);
  if (!box || box.width === 0 || box.height === 0) {
    throw new Error('Chat image is not visible (zero size)');
  }

  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log('Screenshot saved:', screenshotPath);

  await browser.close();
  process.exit(0);
})().catch(async (e) => {
  console.error(e);
  if (page) {
    try {
      await page.screenshot({ path: failureScreenshotPath, fullPage: false });
      console.log('Failure screenshot saved:', failureScreenshotPath);
    } catch (screenshotError) {
      console.error('Failed to take failure screenshot:', screenshotError);
    }
  }
  process.exit(1);
});
