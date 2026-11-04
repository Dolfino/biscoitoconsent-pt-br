import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.BASE_URL || 'http://localhost:3333';
const adminHeaders = { Authorization: 'Bearer centro-fashion-local-admin' };

const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json()) as { status: string; database: string };
assert.equal(health.status, 'ok');
assert.equal(health.database, 'connected');

const consentId = `postgres-smoke-${randomUUID()}`;
const response = await fetch(`${baseUrl}/v1/public/consent-events/browser`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: baseUrl,
    'x-consent-site-key': 'qez_local_public_key',
    'idempotency-key': randomUUID()
  },
  body: JSON.stringify({
    eventId: randomUUID(),
    consentId,
    categories: ['necessary', 'analytics'],
    services: { analytics: ['google_analytics'] },
    revision: 1,
    consentTimestamp: new Date().toISOString(),
    lastConsentTimestamp: new Date().toISOString(),
    languageCode: 'pt-BR',
    sdkVersion: 'postgres-smoke'
  })
});
assert.equal(response.status, 201);
const recorded = await response.json() as { receipt: { receiptId: string; selectionMode: string } };
assert.equal(recorded.receipt.selectionMode, 'customized');

const verification = await fetch(`${baseUrl}/v1/public/receipts/${recorded.receipt.receiptId}/verify`)
  .then((result) => result.json()) as { valid: boolean };
assert.equal(verification.valid, true);

await new Promise((resolve) => setTimeout(resolve, 2500));
const outbox = await fetch(`${baseUrl}/v1/admin/outbox`, { headers: adminHeaders }).then((result) => result.json()) as {
  statuses: Array<{ status: string; total: number }>;
};
assert.ok(outbox.statuses.some((item) => item.status === 'processed' && item.total > 0));

for (const path of ['/demo.html', '/admin.html', '/privacy.html', '/terms.html', '/openapi.json']) {
  const page = await fetch(`${baseUrl}${path}`);
  assert.equal(page.status, 200, path);
}

console.log(`PostgreSQL smoke test aprovado. Recibo: ${recorded.receipt.receiptId}`);
