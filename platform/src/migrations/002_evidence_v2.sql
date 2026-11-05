ALTER TABLE policy_versions
  ADD COLUMN IF NOT EXISTS hash_algorithm TEXT NOT NULL DEFAULT 'SHA-256',
  ADD COLUMN IF NOT EXISTS content_mime_type TEXT NOT NULL DEFAULT 'application/json',
  ADD COLUMN IF NOT EXISTS snapshot_schema_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS supersedes_id UUID REFERENCES policy_versions(id);

ALTER TABLE consent_events
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS referrer_origin TEXT,
  ADD COLUMN IF NOT EXISTS client_time_zone TEXT;

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

CREATE INDEX IF NOT EXISTS idx_dispatches_consent
  ON integration_dispatches(site_id, consent_id, dispatch_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_dispatches_provider_event
  ON integration_dispatches(provider, provider_event_id);


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
