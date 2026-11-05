CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  primary_domain TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  default_consent_days INTEGER NOT NULL DEFAULT 182,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE TABLE IF NOT EXISTS site_allowed_origins (
  organization_id UUID NOT NULL,
  site_id UUID NOT NULL,
  origin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  PRIMARY KEY (site_id, origin),
  FOREIGN KEY (organization_id, site_id) REFERENCES sites(organization_id, id)
);

CREATE TABLE IF NOT EXISTS policy_versions (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  site_id UUID NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  policy_url TEXT,
  terms_url TEXT,
  content_hash TEXT NOT NULL,
  hash_algorithm TEXT NOT NULL DEFAULT 'SHA-256',
  content_mime_type TEXT NOT NULL DEFAULT 'application/json',
  snapshot_schema_version INTEGER NOT NULL DEFAULT 1,
  content_snapshot JSONB,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  supersedes_id UUID REFERENCES policy_versions(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, revision),
  UNIQUE (organization_id, site_id, id),
  FOREIGN KEY (organization_id, site_id) REFERENCES sites(organization_id, id)
);

CREATE TABLE IF NOT EXISTS policy_categories (
  organization_id UUID NOT NULL,
  site_id UUID NOT NULL,
  policy_version_id UUID NOT NULL,
  category_key TEXT NOT NULL,
  label TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL,
  PRIMARY KEY (policy_version_id, category_key),
  FOREIGN KEY (organization_id, site_id, policy_version_id)
    REFERENCES policy_versions(organization_id, site_id, id)
);

CREATE TABLE IF NOT EXISTS policy_services (
  organization_id UUID NOT NULL,
  site_id UUID NOT NULL,
  policy_version_id UUID NOT NULL,
  category_key TEXT NOT NULL,
  service_key TEXT NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (policy_version_id, category_key, service_key),
  FOREIGN KEY (policy_version_id, category_key)
    REFERENCES policy_categories(policy_version_id, category_key)
);

CREATE TABLE IF NOT EXISTS consent_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  site_id UUID NOT NULL,
  consent_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL,
  selection_mode TEXT NOT NULL,
  policy_version_id UUID NOT NULL,
  policy_revision INTEGER NOT NULL,
  language_code TEXT NOT NULL,
  consent_timestamp TIMESTAMPTZ NOT NULL,
  last_consent_timestamp TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  sdk_version TEXT NOT NULL,
  source_url TEXT,
  referrer_origin TEXT,
  client_time_zone TEXT,
  canonical_payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  signing_key_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, idempotency_key),
  FOREIGN KEY (organization_id, site_id, policy_version_id)
    REFERENCES policy_versions(organization_id, site_id, id)
);

CREATE TABLE IF NOT EXISTS consent_event_category_choices (
  organization_id UUID NOT NULL,
  site_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES consent_events(id),
  category_key TEXT NOT NULL,
  accepted BOOLEAN NOT NULL,
  required BOOLEAN NOT NULL,
  PRIMARY KEY (event_id, category_key)
);

CREATE TABLE IF NOT EXISTS consent_event_service_choices (
  organization_id UUID NOT NULL,
  site_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES consent_events(id),
  category_key TEXT NOT NULL,
  service_key TEXT NOT NULL,
  accepted BOOLEAN NOT NULL,
  PRIMARY KEY (event_id, category_key, service_key)
);

CREATE TABLE IF NOT EXISTS consent_receipts (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  site_id UUID NOT NULL,
  event_id UUID NOT NULL UNIQUE REFERENCES consent_events(id),
  receipt_payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  signing_key_id TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_dispatches (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  site_id UUID NOT NULL,
  consent_event_id UUID NOT NULL REFERENCES consent_events(id),
  consent_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  service_key TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  status TEXT NOT NULL,
  transport TEXT NOT NULL,
  dispatch_timestamp TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  provider_payload_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  canonical_payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  signing_key_id TEXT NOT NULL,
  sdk_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, idempotency_key),
  FOREIGN KEY (organization_id, site_id) REFERENCES sites(organization_id, id),
  CHECK (provider IN ('meta', 'google')),
  CHECK (status IN ('sent', 'failed', 'blocked')),
  CHECK (transport IN ('browser', 'server')),
  CHECK (provider_payload_hash IS NULL OR provider_payload_hash ~ '^[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  site_id UUID NOT NULL,
  source_event_id UUID NOT NULL REFERENCES consent_events(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS signing_keys (
  id TEXT PRIMARY KEY,
  algorithm TEXT NOT NULL,
  status TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_events_consent ON consent_events(site_id, consent_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_received ON consent_events(site_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatches_consent ON integration_dispatches(site_id, consent_id, dispatch_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_dispatches_provider_event ON integration_dispatches(provider, provider_event_id);


CREATE OR REPLACE VIEW consent_evidence_report AS
SELECT
  o.name AS organization_name,
  s.primary_domain,
  e.id AS event_id,
  e.consent_id,
  e.action,
  e.selection_mode,
  e.consent_timestamp,
  e.received_at,
  e.source_url,
  e.referrer_origin,
  e.client_time_zone,
  e.policy_revision,
  pv.policy_url,
  pv.content_hash AS policy_content_hash,
  pv.hash_algorithm AS policy_hash_algorithm,
  pv.snapshot_schema_version,
  e.sdk_version,
  e.payload_hash AS event_payload_hash,
  e.signature AS event_signature,
  e.signing_key_id,
  r.id AS receipt_id,
  r.issued_at AS receipt_issued_at,
  r.payload_hash AS receipt_payload_hash,
  r.signature AS receipt_signature,
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'category', cc.category_key,
        'accepted', cc.accepted,
        'required', cc.required
      )
      ORDER BY cc.category_key
    )
    FROM consent_event_category_choices cc
    WHERE cc.event_id = e.id
  ), '[]'::jsonb) AS category_choices,
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'category', sc.category_key,
        'service', sc.service_key,
        'accepted', sc.accepted
      )
      ORDER BY sc.category_key, sc.service_key
    )
    FROM consent_event_service_choices sc
    WHERE sc.event_id = e.id
  ), '[]'::jsonb) AS service_choices,
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'dispatchId', d.id,
        'provider', d.provider,
        'service', d.service_key,
        'providerEventId', d.provider_event_id,
        'eventName', d.event_name,
        'status', d.status,
        'dispatchedAt', d.dispatch_timestamp,
        'payloadHash', d.payload_hash,
        'signature', d.signature
      )
      ORDER BY d.dispatch_timestamp
    )
    FROM integration_dispatches d
    WHERE d.consent_event_id = e.id
  ), '[]'::jsonb) AS integration_dispatches
FROM consent_events e
JOIN organizations o ON o.id = e.organization_id
JOIN sites s ON s.id = e.site_id
JOIN policy_versions pv ON pv.id = e.policy_version_id
LEFT JOIN consent_receipts r ON r.event_id = e.id;
