import type { Database } from './database.js';
import { randomUUID } from './database.js';
import type { AppConfig } from './config.js';
import type {
  BrowserConsent,
  CanonicalConsentEvent,
  CanonicalIntegrationDispatch,
  ConsentAction,
  IntegrationDispatch,
  SelectionMode
} from './contracts.js';
import { signEvidence, verifyEvidence } from './evidence.js';

type SiteRow = {
  id: string;
  organization_id: string;
  public_key: string;
  primary_domain: string;
  default_consent_days: number;
};
type PolicyRow = { id: string; revision: number; content_hash: string };
type CategoryRow = { category_key: string; required: boolean };
type ServiceRow = { category_key: string; service_key: string };

export class ConsentError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export async function findSite(db: Database, siteKey: string, origin?: string) {
  const result = await db.query<SiteRow>(
    `SELECT id, organization_id, public_key, primary_domain, default_consent_days
     FROM sites WHERE public_key = $1 AND status = 'active'`, [siteKey]
  );
  const site = result.rows[0];
  if (!site) throw new ConsentError(401, 'unknown_site', 'Chave pública do site desconhecida.');
  if (origin) {
    const allowed = await db.query(
      `SELECT 1 FROM site_allowed_origins WHERE site_id = $1 AND origin = $2 AND status = 'active'`,
      [site.id, origin]
    );
    if (!allowed.rows.length) throw new ConsentError(403, 'origin_not_allowed', 'Origem não autorizada para este site.');
  }
  return site;
}

function classifySelection(categories: CategoryRow[], accepted: Set<string>): SelectionMode {
  const optional = categories.filter((item) => !item.required).map((item) => item.category_key);
  const acceptedOptional = optional.filter((key) => accepted.has(key));
  if (!acceptedOptional.length) return 'rejected_optional';
  if (acceptedOptional.length === optional.length) return 'accepted_all';
  return 'customized';
}

async function classifyAction(db: Database, siteId: string, consentId: string, selection: SelectionMode): Promise<ConsentAction> {
  const previous = await db.query<{ selection_mode: SelectionMode }>(
    `SELECT selection_mode FROM consent_events WHERE site_id = $1 AND consent_id = $2
     ORDER BY received_at DESC LIMIT 1`, [siteId, consentId]
  );
  if (!previous.rows.length) return 'accepted';
  if (selection === 'rejected_optional' && previous.rows[0].selection_mode !== 'rejected_optional') return 'revoked';
  return 'updated';
}

export async function recordBrowserConsent(args: {
  db: Database;
  config: AppConfig;
  siteKey: string;
  origin?: string;
  idempotencyKey: string;
  input: BrowserConsent;
}) {
  const { db, config, input, idempotencyKey } = args;
  const site = await findSite(db, args.siteKey, args.origin);

  const duplicate = await db.query<{ receipt_payload: unknown }>(
    `SELECT r.receipt_payload FROM consent_receipts r
     JOIN consent_events e ON e.id = r.event_id
     WHERE e.site_id = $1 AND e.idempotency_key = $2`, [site.id, idempotencyKey]
  );
  if (duplicate.rows[0]) return { receipt: duplicate.rows[0].receipt_payload, duplicate: true };

  const policyResult = await db.query<PolicyRow>(
    `SELECT id, revision, content_hash FROM policy_versions
     WHERE site_id = $1 AND revision = $2 AND status IN ('published', 'superseded')`, [site.id, input.revision]
  );
  const policy = policyResult.rows[0];
  if (!policy) throw new ConsentError(422, 'unknown_revision', 'Revisão não publicada ou não pertencente ao site.');

  const categories = (await db.query<CategoryRow>(
    `SELECT category_key, required FROM policy_categories WHERE policy_version_id = $1 ORDER BY position`, [policy.id]
  )).rows;
  const services = (await db.query<ServiceRow>(
    `SELECT category_key, service_key FROM policy_services WHERE policy_version_id = $1`, [policy.id]
  )).rows;
  const knownCategories = new Set(categories.map((item) => item.category_key));
  const accepted = new Set(input.categories);
  for (const key of accepted) {
    if (!knownCategories.has(key)) throw new ConsentError(422, 'unknown_category', `Categoria desconhecida: ${key}`);
  }
  for (const category of categories.filter((item) => item.required)) accepted.add(category.category_key);

  const acceptedServices: Record<string, string[]> = {};
  const rejectedServices: Record<string, string[]> = {};
  for (const service of services) {
    const selected = input.services[service.category_key] || [];
    if (selected.some((key) => !services.some((known) => known.category_key === service.category_key && known.service_key === key))) {
      throw new ConsentError(422, 'unknown_service', `Serviço desconhecido na categoria ${service.category_key}.`);
    }
    const target = accepted.has(service.category_key) && selected.includes(service.service_key)
      ? acceptedServices : rejectedServices;
    (target[service.category_key] ||= []).push(service.service_key);
  }

  const acceptedCategories = categories.map((item) => item.category_key).filter((key) => accepted.has(key));
  const rejectedCategories = categories.map((item) => item.category_key).filter((key) => !accepted.has(key));
  const selectionMode = classifySelection(categories, accepted);
  const action = await classifyAction(db, site.id, input.consentId, selectionMode);
  const receivedAt = new Date().toISOString();
  const eventId = input.eventId || randomUUID();
  const sourceUrl = sanitizeSourceUrl(input.sourceUrl);
  const referrerOrigin = sanitizeOrigin(input.referrerOrigin);
  const canonical: CanonicalConsentEvent = {
    eventId,
    organizationId: site.organization_id,
    siteId: site.id,
    consentId: input.consentId,
    action,
    selectionMode,
    policyRevision: policy.revision,
    acceptedCategories,
    rejectedCategories,
    acceptedServices,
    rejectedServices,
    languageCode: input.languageCode,
    consentTimestamp: input.consentTimestamp,
    lastConsentTimestamp: input.lastConsentTimestamp,
    receivedAt,
    sdkVersion: input.sdkVersion,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(referrerOrigin ? { referrerOrigin } : {}),
    ...(input.clientTimeZone ? { clientTimeZone: input.clientTimeZone } : {})
  };
  const signed = signEvidence(canonical, config.hmacKey);
  const receiptId = randomUUID();
  const receipt = {
    receiptId,
    eventId,
    consentId: input.consentId,
    siteId: site.id,
    action,
    selectionMode,
    policyRevision: policy.revision,
    policyHash: policy.content_hash,
    issuedAt: receivedAt,
    payloadHash: signed.payloadHash,
    signature: signed.signature,
    signingKeyId: config.hmacKeyId
  };

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO signing_keys (id, algorithm, status, valid_from) VALUES ($1, 'HMAC-SHA-256', 'active', now())
       ON CONFLICT (id) DO NOTHING`, [config.hmacKeyId]
    );
    await tx.query(
      `INSERT INTO consent_events
       (id, organization_id, site_id, consent_id, idempotency_key, action, selection_mode,
        policy_version_id, policy_revision, language_code, consent_timestamp, last_consent_timestamp,
        received_at, sdk_version, source_url, referrer_origin, client_time_zone,
        canonical_payload, payload_hash, signature, signing_key_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21)`,
      [eventId, site.organization_id, site.id, input.consentId, idempotencyKey, action, selectionMode,
        policy.id, policy.revision, input.languageCode, input.consentTimestamp, input.lastConsentTimestamp,
        receivedAt, input.sdkVersion, sourceUrl, referrerOrigin, input.clientTimeZone,
        signed.canonicalPayload, signed.payloadHash, signed.signature, config.hmacKeyId]
    );
    for (const category of categories) {
      await tx.query(
        `INSERT INTO consent_event_category_choices
         (organization_id, site_id, event_id, category_key, accepted, required) VALUES ($1,$2,$3,$4,$5,$6)`,
        [site.organization_id, site.id, eventId, category.category_key, accepted.has(category.category_key), category.required]
      );
    }
    for (const service of services) {
      const serviceAccepted = (acceptedServices[service.category_key] || []).includes(service.service_key);
      await tx.query(
        `INSERT INTO consent_event_service_choices
         (organization_id, site_id, event_id, category_key, service_key, accepted) VALUES ($1,$2,$3,$4,$5,$6)`,
        [site.organization_id, site.id, eventId, service.category_key, service.service_key, serviceAccepted]
      );
    }
    await tx.query(
      `INSERT INTO consent_receipts
       (id, organization_id, site_id, event_id, receipt_payload, payload_hash, signature, signing_key_id, issued_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)`,
      [receiptId, site.organization_id, site.id, eventId, JSON.stringify(receipt), signed.payloadHash,
        signed.signature, config.hmacKeyId, receivedAt]
    );
    await tx.query(
      `INSERT INTO outbox_events
       (id, organization_id, site_id, source_event_id, event_type, payload)
       VALUES ($1,$2,$3,$4,'consent.recorded',$5::jsonb)`,
      [randomUUID(), site.organization_id, site.id, eventId, JSON.stringify({ eventId, receiptId, action })]
    );
  });
  return { receipt, duplicate: false };
}

export async function recordIntegrationDispatch(args: {
  db: Database;
  config: AppConfig;
  siteKey: string;
  origin?: string;
  idempotencyKey: string;
  input: IntegrationDispatch;
}) {
  const { db, config, input, idempotencyKey } = args;
  const site = await findSite(db, args.siteKey, args.origin);

  const duplicate = await db.query<{
    id: string; consent_event_id: string; provider: string; provider_event_id: string;
    status: string; payload_hash: string; signature: string; signing_key_id: string; received_at: string;
  }>(
    `SELECT id, consent_event_id, provider, provider_event_id, status,
            payload_hash, signature, signing_key_id, received_at
     FROM integration_dispatches WHERE site_id = $1 AND idempotency_key = $2`,
    [site.id, idempotencyKey]
  );
  if (duplicate.rows[0]) {
    const row = duplicate.rows[0];
    return {
      dispatch: {
        dispatchId: row.id,
        consentEventId: row.consent_event_id,
        provider: row.provider,
        providerEventId: row.provider_event_id,
        status: row.status,
        receivedAt: row.received_at,
        payloadHash: row.payload_hash,
        signature: row.signature,
        signingKeyId: row.signing_key_id
      },
      duplicate: true
    };
  }

  const consentResult = await db.query<{
    event_id: string; consent_id: string; service_key: string; accepted: boolean;
  }>(
    `SELECT e.id AS event_id, e.consent_id, sc.service_key, sc.accepted
     FROM consent_events e
     JOIN consent_event_service_choices sc ON sc.event_id = e.id
     WHERE e.id = $1 AND e.site_id = $2 AND e.consent_id = $3 AND sc.service_key = $4`,
    [input.consentEventId, site.id, input.consentId, input.serviceKey]
  );
  const consent = consentResult.rows[0];
  if (!consent) {
    throw new ConsentError(422, 'consent_service_not_found', 'Evento de consentimento ou serviço não encontrado.');
  }

  const expectedService = input.provider === 'meta' ? 'meta_pixel' : 'google_analytics';
  if (input.serviceKey !== expectedService) {
    throw new ConsentError(422, 'provider_service_mismatch', 'Provedor e serviço não correspondem.');
  }
  if (input.status === 'sent' && !consent.accepted) {
    throw new ConsentError(409, 'consent_not_granted', 'O serviço não estava autorizado neste consentimento.');
  }

  const dispatchId = randomUUID();
  const receivedAt = new Date().toISOString();
  const canonical: CanonicalIntegrationDispatch = {
    dispatchId,
    organizationId: site.organization_id,
    siteId: site.id,
    consentEventId: input.consentEventId,
    consentId: input.consentId,
    provider: input.provider,
    serviceKey: input.serviceKey,
    providerEventId: input.providerEventId,
    eventName: input.eventName,
    status: input.status,
    transport: input.transport,
    dispatchTimestamp: input.dispatchTimestamp,
    receivedAt,
    ...(input.providerPayloadHash ? { providerPayloadHash: input.providerPayloadHash } : {}),
    metadata: input.metadata,
    sdkVersion: input.sdkVersion
  };
  const signed = signEvidence(canonical, config.hmacKey);

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO signing_keys (id, algorithm, status, valid_from) VALUES ($1, 'HMAC-SHA-256', 'active', now())
       ON CONFLICT (id) DO NOTHING`, [config.hmacKeyId]
    );
    await tx.query(
      `INSERT INTO integration_dispatches
       (id, organization_id, site_id, consent_event_id, consent_id, idempotency_key,
        provider, service_key, provider_event_id, event_name, status, transport,
        dispatch_timestamp, received_at, provider_payload_hash, metadata,
        canonical_payload, payload_hash, signature, signing_key_id, sdk_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,$19,$20,$21)`,
      [dispatchId, site.organization_id, site.id, input.consentEventId, input.consentId,
        idempotencyKey, input.provider, input.serviceKey, input.providerEventId, input.eventName,
        input.status, input.transport, input.dispatchTimestamp, receivedAt,
        input.providerPayloadHash, JSON.stringify(input.metadata), signed.canonicalPayload,
        signed.payloadHash, signed.signature, config.hmacKeyId, input.sdkVersion]
    );
  });

  return {
    dispatch: {
      dispatchId,
      consentEventId: input.consentEventId,
      provider: input.provider,
      providerEventId: input.providerEventId,
      status: input.status,
      receivedAt,
      payloadHash: signed.payloadHash,
      signature: signed.signature,
      signingKeyId: config.hmacKeyId
    },
    duplicate: false
  };
}

export async function verifyReceipt(db: Database, config: AppConfig, receiptId: string) {
  const result = await db.query<{
    id: string; event_id: string; consent_id: string; receipt_payload: Record<string, unknown>;
    payload_hash: string; signature: string; signing_key_id: string; canonical_payload: unknown;
  }>(`SELECT r.id, r.event_id, e.consent_id, r.receipt_payload, r.payload_hash, r.signature,
             r.signing_key_id, e.canonical_payload
      FROM consent_receipts r JOIN consent_events e ON e.id = r.event_id
      WHERE r.id = $1`, [receiptId]);
  const receipt = result.rows[0];
  if (!receipt) throw new ConsentError(404, 'receipt_not_found', 'Recibo não encontrado.');
  const recomputed = signEvidence(receipt.canonical_payload, config.hmacKey);
  const valid = receipt.signing_key_id === config.hmacKeyId
    && recomputed.payloadHash === receipt.payload_hash
    && verifyEvidence(receipt.payload_hash, receipt.signature, config.hmacKey);
  const canonical = receipt.canonical_payload as {
    acceptedCategories?: unknown;
    acceptedServices?: unknown;
  };
  const acceptedCategories = Array.isArray(canonical.acceptedCategories)
    ? canonical.acceptedCategories.filter((item): item is string => typeof item === 'string')
    : [];
  const acceptedServices = canonical.acceptedServices && typeof canonical.acceptedServices === 'object'
    ? canonical.acceptedServices
    : {};
  return {
    receiptId: receipt.id,
    eventId: receipt.event_id,
    consentId: receipt.consent_id,
    valid,
    acceptedCategories,
    acceptedServices,
    payloadHash: receipt.payload_hash,
    signingKeyId: receipt.signing_key_id,
    checkedAt: new Date().toISOString()
  };
}

export async function processOutbox(db: Database) {
  const pending = await db.query<{ id: string }>(
    `SELECT id FROM outbox_events WHERE status = 'pending' ORDER BY created_at LIMIT 50`
  );
  for (const event of pending.rows) {
    await db.query(
      `UPDATE outbox_events SET status = 'processed', attempts = attempts + 1, processed_at = now()
       WHERE id = $1 AND status = 'pending'`, [event.id]
    );
  }
  return pending.rows.length;
}

function sanitizeSourceUrl(value?: string) {
  if (!value) return undefined;
  const url = new URL(value);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function sanitizeOrigin(value?: string) {
  if (!value) return undefined;
  return new URL(value).origin;
}
