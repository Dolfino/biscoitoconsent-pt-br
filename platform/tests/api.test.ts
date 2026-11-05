import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { createDatabase } from '../src/database.js';
import { getConfig } from '../src/config.js';

describe('API de consentimento', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const db = await createDatabase(`memory://${randomUUID()}`);
    app = await buildApp({
      db,
      config: getConfig({ databasePath: 'memory://', hmacKey: 'test-secret', adminToken: 'test-admin' })
    });
  });

  afterEach(async () => { if (app) await app.close(); });

  const payload = (overrides: Record<string, unknown> = {}) => ({
    eventId: randomUUID(),
    consentId: 'consent-browser-123456',
    categories: ['necessary', 'analytics'],
    services: { analytics: ['google_analytics'] },
    revision: 2,
    consentTimestamp: '2026-11-04T16:30:00.000Z',
    lastConsentTimestamp: '2026-11-04T16:30:00.000Z',
    languageCode: 'pt-BR',
    sdkVersion: 'test',
    ...overrides
  });

  async function post(body: unknown, key = randomUUID()) {
    return await app.inject({
      method: 'POST',
      url: '/v1/public/consent-events/browser',
      headers: {
        origin: 'http://localhost:3333',
        'x-consent-site-key': 'qez_local_public_key',
        'idempotency-key': key
      },
      payload: body as Record<string, unknown>
    });
  }

  it('publica categorias e serviços do site para o SDK', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/public/config?siteKey=qez_local_public_key',
      headers: { origin: 'http://localhost:3000' }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.consentDays).toBe(182);
    expect(body.policy).toMatchObject({
      revision: 2,
      hash_algorithm: 'SHA-256',
      snapshot_schema_version: 2
    });
    expect(body.policy.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'necessary', required: true })
    ]));
    expect(body.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ categoryKey: 'analytics', key: 'google_analytics', label: 'Google Analytics' })
    ]));
  });

  it('grava escolha personalizada e devolve recibo assinado', async () => {
    const response = await post(payload());
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.receipt.action).toBe('accepted');
    expect(body.receipt.selectionMode).toBe('customized');
    expect(body.receipt.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('deduplica pela chave de idempotência', async () => {
    const key = randomUUID();
    const first = await post(payload(), key);
    const second = await post(payload({ eventId: randomUUID() }), key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().duplicate).toBe(true);
    expect(second.json().receipt.receiptId).toBe(first.json().receipt.receiptId);
  });

  it('classifica retirada de opcionais como revogação', async () => {
    expect((await post(payload())).statusCode).toBe(201);
    const response = await post(payload({
      eventId: randomUUID(),
      categories: ['necessary'],
      services: {},
      lastConsentTimestamp: '2026-11-04T17:00:00.000Z'
    }));
    expect(response.statusCode).toBe(201);
    expect(response.json().receipt.action).toBe('revoked');
    expect(response.json().receipt.selectionMode).toBe('rejected_optional');
  });

  it('rejeita revisão desconhecida e origem não autorizada', async () => {
    expect((await post(payload({ revision: 99 }))).statusCode).toBe(422);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/public/consent-events/browser',
      headers: {
        origin: 'https://invasor.example',
        'x-consent-site-key': 'qez_local_public_key',
        'idempotency-key': randomUUID()
      },
      payload: payload()
    });
    expect(response.statusCode).toBe(403);
  });

  it('verifica o recibo persistido', async () => {
    const recorded = await post(payload());
    const receiptId = recorded.json().receipt.receiptId;
    const verified = await app.inject({ method: 'GET', url: `/v1/public/receipts/${receiptId}/verify` });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().valid).toBe(true);
  });

  it('publica o snapshot imutável da política', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/public/policies/2?siteKey=qez_local_public_key'
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      revision: 2,
      hash_algorithm: 'SHA-256',
      snapshot_schema_version: 2,
      content_snapshot: { schemaVersion: 2, revision: 2 }
    });
    expect(response.json().content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('correlaciona e assina disparo real do Meta Pixel', async () => {
    const recorded = await post(payload({
      categories: ['necessary', 'analytics', 'advertising'],
      services: { analytics: ['google_analytics'], advertising: ['meta_pixel'] }
    }));
    const receipt = recorded.json().receipt;
    const idempotencyKey = randomUUID();
    const request = {
      method: 'POST',
      url: '/v1/public/integration-dispatches/browser',
      headers: {
        origin: 'http://localhost:3333',
        'x-consent-site-key': 'qez_local_public_key',
        'idempotency-key': idempotencyKey
      },
      payload: {
        consentEventId: receipt.eventId,
        consentId: receipt.consentId,
        provider: 'meta',
        serviceKey: 'meta_pixel',
        providerEventId: randomUUID(),
        eventName: 'PageView',
        status: 'sent',
        transport: 'browser',
        dispatchTimestamp: '2026-11-05T12:00:00.000Z',
        metadata: { pagePath: '/' },
        sdkVersion: 'test'
      }
    } as const;
    const response = await app.inject(request);
    expect(response.statusCode).toBe(201);
    expect(response.json().dispatch).toMatchObject({
      consentEventId: receipt.eventId,
      provider: 'meta',
      status: 'sent'
    });
    expect(response.json().dispatch.signature).toMatch(/^[a-f0-9]{64}$/);

    const duplicate = await app.inject(request);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      duplicate: true,
      dispatch: {
        dispatchId: response.json().dispatch.dispatchId,
        consentEventId: receipt.eventId,
        provider: 'meta',
        status: 'sent'
      }
    });
  });

  it('impede registrar envio Meta sem autorização', async () => {
    const recorded = await post(payload({ categories: ['necessary'], services: {} }));
    const receipt = recorded.json().receipt;
    const response = await app.inject({
      method: 'POST',
      url: '/v1/public/integration-dispatches/browser',
      headers: {
        origin: 'http://localhost:3333',
        'x-consent-site-key': 'qez_local_public_key',
        'idempotency-key': randomUUID()
      },
      payload: {
        consentEventId: receipt.eventId,
        consentId: receipt.consentId,
        provider: 'meta',
        serviceKey: 'meta_pixel',
        providerEventId: randomUUID(),
        eventName: 'PageView',
        status: 'sent',
        dispatchTimestamp: '2026-11-05T12:00:00.000Z',
        sdkVersion: 'test'
      }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('consent_not_granted');
  });
});
