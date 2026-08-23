/**
 * Smoke test for the Chrome cookie import mechanism used by
 * server/modules/browser-use/browser-use.service.ts.
 *
 * Replicates the service flow against a synthetic Chrome profile so it can run
 * while the user's real Chrome stays open:
 *   1. Create a fresh Chrome profile; seed cookies via CDP Network.setCookie
 *      with a graceful Browser.close (mimics a real user's profile state).
 *   2. Copy the profile to a temp dir (mimics copyChromeProfileToTemp).
 *   3. Launch real chrome.exe headless + CDP on the copy, read decrypted
 *      cookies via Network.getAllCookies (mimics extractCookiesViaCdp).
 *   4. Convert CDP cookies to Playwright shape and persist them into another
 *      persistent profile (mimics importCookiesToProfile), then read back.
 *
 * Run: node debug/chrome-import-smoke.cjs
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { chromium } = require('playwright');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForCdpReady(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('CDP endpoint not ready');
}

async function launchChrome(userDataDir, extraArgs = []) {
  const port = await getFreePort();
  const child = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    ...extraArgs,
    'about:blank',
  ], { stdio: 'ignore' });
  await waitForCdpReady(port);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  return { child, browser };
}

async function closeChrome({ child, browser }) {
  try {
    const browserCdp = await browser.newBrowserCDPSession();
    await browserCdp.send('Browser.close'); // graceful: flushes + commits stores
  } catch {}
  await new Promise((r) => setTimeout(r, 2000));
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function getAllCookies(browser) {
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || (await ctx.newPage());
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const result = await cdp.send('Network.getAllCookies');
  return result.cookies || [];
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-import-smoke-'));
  const seedProfile = path.join(tmp, 'seed');
  const copiedProfile = path.join(tmp, 'copy');
  const importProfile = path.join(tmp, 'imported');

  // 1. Seed a Chrome profile via CDP, close gracefully so the store commits.
  console.log('[1/4] seeding synthetic Chrome profile via CDP...');
  let session = await launchChrome(seedProfile);
  let ctx = session.browser.contexts()[0];
  let page = ctx.pages()[0] || (await ctx.newPage());
  let cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const expires = Math.floor(Date.now() / 1000) + 86400;
  await cdp.send('Network.setCookie', {
    name: 'smoke_session', value: 'decrypted-value-123',
    domain: '.example.com', path: '/', secure: true, sameSite: 'Lax', expires,
  });
  await cdp.send('Network.setCookie', {
    name: 'smoke_plain', value: 'hello world',
    domain: 'example.org', path: '/', expires,
  });
  await closeChrome(session);

  const seededCookieDb = path.join(seedProfile, 'Default', 'Network', 'Cookies');
  if (!fs.existsSync(seededCookieDb)) {
    throw new Error('seeded profile has no Network/Cookies store');
  }
  console.log('      cookie store created, size =', fs.statSync(seededCookieDb).size);

  // 2. Copy profile (source Chrome is closed, plain copy works).
  console.log('[2/4] copying profile...');
  fs.cpSync(seedProfile, copiedProfile, { recursive: true });

  // 3. Extract decrypted cookies from the copy via CDP.
  console.log('[3/4] extracting cookies via CDP...');
  session = await launchChrome(copiedProfile);
  const cdpCookies = await getAllCookies(session.browser);
  await closeChrome(session);

  const found = cdpCookies.filter((c) => c.name.startsWith('smoke_'));
  console.log(`      got ${cdpCookies.length} cookies total, ${found.length} smoke cookies`);
  for (const c of found) console.log(`      ${c.name}=${c.value}`);
  const extracted = found.find((c) => c.name === 'smoke_session');
  if (!extracted || extracted.value !== 'decrypted-value-123') {
    throw new Error('CDP extraction did not return the decrypted smoke_session cookie');
  }

  // 4. Convert + persist into a planrla-style profile, then read back.
  console.log('[4/4] importing into a planrla-style profile...');
  const playwrightCookies = cdpCookies.map((c) => {
    const out = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      secure: Boolean(c.secure),
      httpOnly: Boolean(c.httpOnly),
    };
    if (['Strict', 'Lax', 'None'].includes(c.sameSite)) out.sameSite = c.sameSite;
    if (!c.session && typeof c.expires === 'number' && c.expires > 0) out.expires = c.expires;
    return out;
  });

  let context = await chromium.launchPersistentContext(importProfile, {
    headless: true,
    args: ['--disable-dev-shm-usage'],
  });
  await context.addCookies(playwrightCookies);
  await context.close();

  context = await chromium.launchPersistentContext(importProfile, {
    headless: true,
    args: ['--disable-dev-shm-usage'],
  });
  const persisted = (await context.cookies()).filter((c) => c.name.startsWith('smoke_'));
  await context.close();

  const persistedSession = persisted.find((c) => c.name === 'smoke_session');
  if (!persistedSession || persistedSession.value !== 'decrypted-value-123') {
    throw new Error('imported profile did not persist smoke_session; got ' + JSON.stringify(persisted));
  }
  console.log(`      persisted smoke cookies verified: ${persisted.map((c) => c.name).join(', ')}`);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nSMOKE TEST PASSED');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
});
