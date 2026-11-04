import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { browserConsentSchema } from './contracts.js';
import { createDatabase, PILOT, type Database } from './database.js';
import { getConfig, type AppConfig } from './config.js';
import { ConsentError, findSite, processOutbox, recordBrowserConsent, verifyReceipt } from './service.js';
import { openapi } from './openapi.js';

export async function buildApp(options: { config?: AppConfig; db?: Database } = {}) {
  const config = options.config || getConfig();
  const db = options.db || await createDatabase(config.databasePath, config.databaseUrl);
  const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });

  const allowedOrigins = new Set([
    'http://localhost:3333', 'http://127.0.0.1:3333',
    'http://localhost:3000', 'http://127.0.0.1:3000',
    'https://qez.com.br', 'https://www.qez.com.br'
  ]);
  await app.register(cors, {
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
    methods: ['GET', 'POST']
  });
  await app.register(fastifyStatic, {
    root: path.resolve('public'),
    prefix: '/'
  });
  await app.register(fastifyStatic, {
    root: path.resolve('..', 'dist'),
    prefix: '/vendor/',
    decorateReply: false
  });

  app.get('/api/health', async () => {
    const check = await db.query<{ now: string }>('SELECT now()::text AS now');
    return { status: 'ok', database: 'connected', time: check.rows[0].now };
  });

  app.get('/openapi.json', async () => openapi);

  app.get('/v1/public/config', async (request) => {
    const query = request.query as { siteKey?: string };
    const site = await findSite(db, query.siteKey || '');
    const policy = await db.query(
      `SELECT id, revision, policy_url, terms_url FROM policy_versions
       WHERE site_id = $1 AND status = 'published' ORDER BY revision DESC LIMIT 1`, [site.id]
    );
    const categories = await db.query(
      `SELECT category_key AS key, label, required FROM policy_categories
       WHERE policy_version_id = $1 ORDER BY position`, [(policy.rows[0] as { id: string }).id]
    );
    const services = await db.query(
      `SELECT category_key AS "categoryKey", service_key AS key, label FROM policy_services
       WHERE policy_version_id = $1 ORDER BY category_key, service_key`, [(policy.rows[0] as { id: string }).id]
    );
    return {
      siteId: site.id,
      domain: site.primary_domain,
      consentDays: site.default_consent_days,
      policy: policy.rows[0],
      categories: categories.rows,
      services: services.rows
    };
  });

  app.post('/v1/public/consent-events/browser', async (request, reply) => {
    const siteKey = String(request.headers['x-consent-site-key'] || '');
    const idempotencyKey = String(request.headers['idempotency-key'] || '');
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return reply.code(400).send({ code: 'invalid_idempotency_key', message: 'Idempotency-Key é obrigatório.' });
    }
    if (!allowRequest(`${siteKey}:${request.ip}`)) {
      return reply.code(429).send({ code: 'rate_limited', message: 'Muitas solicitações. Tente novamente em instantes.' });
    }
    const parsed = browserConsentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'invalid_payload', issues: parsed.error.issues });
    }
    try {
      const result = await recordBrowserConsent({
        db,
        config,
        siteKey,
        origin: request.headers.origin,
        idempotencyKey,
        input: parsed.data
      });
      return reply.code(result.duplicate ? 200 : 201).send(result);
    } catch (error) {
      if (error instanceof ConsentError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.get('/v1/public/receipts/:id/verify', async (request, reply) => {
    try {
      return await verifyReceipt(db, config, (request.params as { id: string }).id);
    } catch (error) {
      if (error instanceof ConsentError) return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      throw error;
    }
  });

  app.get('/v1/admin/summary', { preHandler: adminGuard(config) }, async () => {
    const totals = await db.query<{ total: number; accepted: number; rejected: number; customized: number }>(
      `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE selection_mode = 'accepted_all')::int AS accepted,
       count(*) FILTER (WHERE selection_mode = 'rejected_optional')::int AS rejected,
       count(*) FILTER (WHERE selection_mode = 'customized')::int AS customized
       FROM consent_events WHERE site_id = $1`, [PILOT.siteId]
    );
    return { organization: 'Centro Fashion', site: 'qez.com.br', ...totals.rows[0] };
  });

  app.get('/v1/admin/events', { preHandler: adminGuard(config) }, async () => {
    const result = await db.query(
      `SELECT e.id, e.consent_id, e.action, e.selection_mode, e.policy_revision,
              e.received_at, e.payload_hash, e.signing_key_id, r.id AS receipt_id
       FROM consent_events e JOIN consent_receipts r ON r.event_id = e.id
       WHERE e.site_id = $1 ORDER BY e.received_at DESC LIMIT 100`, [PILOT.siteId]
    );
    return { events: result.rows };
  });

  app.get('/v1/admin/events/:id', { preHandler: adminGuard(config) }, async (request, reply) => {
    const result = await db.query(
      `SELECT e.*, r.receipt_payload FROM consent_events e
       JOIN consent_receipts r ON r.event_id = e.id WHERE e.id = $1`, [(request.params as { id: string }).id]
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'not_found' });
    return result.rows[0];
  });

  app.get('/v1/admin/sites', { preHandler: adminGuard(config) }, async () => {
    const result = await db.query(
      `SELECT s.id, s.name, s.primary_domain, s.default_consent_days, s.status,
              o.id AS organization_id, o.name AS organization_name,
              max(p.revision) FILTER (WHERE p.status = 'published') AS published_revision
       FROM sites s JOIN organizations o ON o.id = s.organization_id
       LEFT JOIN policy_versions p ON p.site_id = s.id
       GROUP BY s.id, o.id ORDER BY s.created_at`
    );
    return { sites: result.rows };
  });

  app.get('/v1/admin/outbox', { preHandler: adminGuard(config) }, async () => {
    const result = await db.query(
      `SELECT status, count(*)::int AS total FROM outbox_events GROUP BY status ORDER BY status`
    );
    return { statuses: result.rows };
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    if (error instanceof ConsentError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    }
    return reply.code(500).send({ code: 'internal_error', message: 'Erro interno.' });
  });

  const outboxTimer = setInterval(() => {
    processOutbox(db).catch((error) => app.log.error(error, 'Falha ao processar outbox'));
  }, 2_000);
  outboxTimer.unref();
  app.addHook('onClose', async () => {
    clearInterval(outboxTimer);
    await db.close();
  });
  return app;
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function allowRequest(key: string) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= 60;
}

function adminGuard(config: AppConfig) {
  return async (request: { headers: Record<string, unknown> }, reply: { code: (value: number) => { send: (body: unknown) => unknown } }) => {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (token !== config.adminToken) return reply.code(401).send({ code: 'unauthorized' });
  };
}

if (process.env.NODE_ENV !== 'test') {
  const config = getConfig();
  const app = await buildApp({ config });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`Demonstração: http://localhost:${config.port}/demo.html`);
  app.log.info(`Painel: http://localhost:${config.port}/admin.html`);
}
