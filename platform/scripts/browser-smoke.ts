import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const baseUrl = process.env.BASE_URL || 'http://localhost:3333';
const browser = await chromium.launch({ headless: true, executablePath });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('console', (message) => console.log(`[browser:${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => console.error(`[browser:error] ${error.message}`));
  await page.addInitScript("Object.defineProperty(navigator, 'webdriver', { get: () => false })");
  page.setDefaultTimeout(15_000);
  await page.goto(`${baseUrl}/demo.html`, { waitUntil: 'networkidle' });
  console.log(await page.evaluate(() => ({
    cookieConsentLoaded: typeof (globalThis as typeof globalThis & { CookieConsent?: unknown }).CookieConsent !== 'undefined',
    htmlClass: document.documentElement.className,
    buttons: [...document.querySelectorAll('button')].map((button) => button.textContent?.trim())
  })));
  await page.getByRole('button', { name: 'Aceitar todos', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelector('#receipt')?.textContent?.includes('receiptId'));
  const receipt = await page.locator('#receipt').textContent();
  assert.match(receipt || '', /"signature":\s*"[a-f0-9]{64}"/);
  await mkdir('.artifacts', { recursive: true });
  await page.screenshot({ path: '.artifacts/banner-flow.png', fullPage: true });

  await page.goto(`${baseUrl}/admin.html`, { waitUntil: 'networkidle' });
  await page.getByLabel('Token administrativo').fill(process.env.ADMIN_TOKEN || 'centro-fashion-local-admin');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#events')?.textContent?.includes('Carregando'));
  assert.match(await page.locator('#events').textContent() || '', /accepted|updated|revoked/);
  await page.screenshot({ path: '.artifacts/admin.png', fullPage: true });
  console.log('Browser smoke test aprovado. Screenshots em .artifacts/.');
} finally {
  await browser.close();
}
