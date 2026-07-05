import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'docs', 'screenshots');
const base = 'http://localhost:5173';

async function waitForPage(page, ms = 2500) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function capture(name, url, page, setup) {
  if (setup) await setup(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForPage(page);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log('saved', file);
}

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

await capture('home', `${base}/#/`, page);
await capture('auth', `${base}/#/auth`, page, async (p) => {
  await p.addInitScript(() => {
    window.localStorage.removeItem('agentwatch_guest_mode');
  });
});
await capture('dashboard', `${base}/#/dashboard`, page, async (p) => {
  await p.addInitScript(() => {
    window.localStorage.setItem('agentwatch_guest_mode', '1');
  });
});
await capture('settings', `${base}/#/settings`, page, async (p) => {
  await p.addInitScript(() => {
    window.localStorage.setItem('agentwatch_guest_mode', '1');
  });
});

await browser.close();
