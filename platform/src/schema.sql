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
