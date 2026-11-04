import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const executablePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const siteUrl = process.env.QEZ_URL || 'http://localhost:3000';
const apiUrl = process.env.CONSENT_API_URL || 'http://localhost:3333';
const adminToken = process.env.ADMIN_TOKEN || 'centro-fashion-local-admin';
const browser = await chromium.launch({ headless: true, executablePath });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('console', (message) => console.log(`[qez:${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => console.error(`[qez:error] ${error.message}`));
  page.on('requestfailed', (request) => console.error(`[qez:requestfailed] ${request.url()} ${request.failure()?.errorText}`));
  page.on('response', (response) => {
    if (response.url().includes('/v1/public/')) console.log(`[qez:api] ${response.status()} ${response.url()}`);
  });
  await page.addInitScript("Object.defineProperty(navigator, 'webdriver', { get: () => false })");
  page.setDefaultTimeout(20_000);

  await page.goto(siteUrl, { waitUntil: 'networkidle' });
  await mkdir('.artifacts', { recursive: true });
  await page.screenshot({ path: '.artifacts/qez-before-consent.png', fullPage: true });
  console.log(await page.evaluate(() => ({
    buttons: [...document.querySelectorAll('button')].map((button) => button.textContent?.trim()),
    consentRoot: Boolean(document.querySelector('#cc-main')),
    storageKeys: Object.keys(localStorage)
  })));
  await page.getByRole('button', { name: 'Aceitar todos', exact: true }).click();
  await page.waitForFunction(() => localStorage.getItem('cf_consent_receipt')?.includes('receiptId'));

  const receipt = await page.evaluate(() => JSON.parse(localStorage.getItem('cf_consent_receipt') || '{}')) as {
    eventId?: string;
    receiptId?: string;
    signature?: string;
  };
  assert.match(receipt.signature || '', /^[a-f0-9]{64}$/);
  assert.ok(receipt.eventId);

  const eventsResponse = await page.request.get(`${apiUrl}/v1/admin/events`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(eventsResponse.status(), 200);
  const events = await eventsResponse.json() as { events: Array<{ id: string }> };
  assert.ok(events.events.some((event) => event.id === receipt.eventId));

  await page.screenshot({ path: '.artifacts/qez-consent.png', fullPage: true });
  console.log(`Integração QEZ aprovada: recibo ${receipt.receiptId}.`);

  const offlinePage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await offlinePage.addInitScript("Object.defineProperty(navigator, 'webdriver', { get: () => false })");
  await offlinePage.route(`${apiUrl}/v1/public/**`, (route) => route.abort('internetdisconnected'));
  await offlinePage.goto(siteUrl, { waitUntil: 'networkidle' });
  await offlinePage.getByRole('button', { name: 'Rejeitar opcionais', exact: true }).click();
  await offlinePage.waitForFunction(() => {
    const queue = JSON.parse(localStorage.getItem('cf_consent_outbox') || '[]') as unknown[];
    return queue.length === 1;
  });
  const offlineState = await offlinePage.evaluate(() => ({
    queued: JSON.parse(localStorage.getItem('cf_consent_outbox') || '[]').length,
    receipt: localStorage.getItem('cf_consent_receipt')
  }));
  assert.equal(offlineState.queued, 1);
  assert.equal(offlineState.receipt, null);
  await offlinePage.screenshot({ path: '.artifacts/qez-offline-queued.png', fullPage: true });
  console.log('Cenário offline aprovado: consentimento preservado na fila local.');
} finally {
  await browser.close();
}
