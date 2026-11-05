import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { canonicalJson } from './evidence.js';
import { PILOT_POLICY_V2, PILOT_POLICY_V2_ID } from './policy.js';

export type QueryResult<T> = { rows: T[] };
export interface Database {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  transaction<T>(callback: (tx: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export const PILOT = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  siteId: '20000000-0000-4000-8000-000000000001',
  legacyPolicyId: '30000000-0000-4000-8000-000000000001',
  policyId: PILOT_POLICY_V2_ID,
  siteKey: 'qez_local_public_key',
  revision: 2
} as const;

export async function createDatabase(path: string, databaseUrl?: string): Promise<Database> {
  const db: Database & { exec?: (sql: string) => Promise<unknown> } = databaseUrl
    ? createPostgresDatabase(databaseUrl)
    : new PGlite(path) as unknown as Database & { exec: (sql: string) => Promise<unknown> };
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const applied = await db.query<{ version: string }>('SELECT version FROM schema_migrations WHERE version = $1', ['001_initial']);
  if (!applied.rows.length) {
    if (db.exec) {
      await db.exec(`BEGIN; ${schema} INSERT INTO schema_migrations (version) VALUES ('001_initial'); COMMIT;`);
    } else {
      await db.transaction(async (tx) => {
        await tx.query(schema);
        await tx.query('INSERT INTO schema_migrations (version) VALUES ($1)', ['001_initial']);
      });
    }
  }
  await applyMigration(db, '002_evidence_v2', './migrations/002_evidence_v2.sql');
  await applyMigration(db, '003_classify_legacy_policy_hashes', './migrations/003_classify_legacy_policy_hashes.sql');
  await seedDatabase(db);
  return db;
}

async function applyMigration(
  db: Database & { exec?: (sql: string) => Promise<unknown> },
  version: string,
  relativePath: string
) {
  const applied = await db.query<{ version: string }>(
    'SELECT version FROM schema_migrations WHERE version = $1',
    [version]
  );
  if (applied.rows.length) return;

  const sql = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  if (db.exec) {
    await db.exec(`BEGIN; ${sql} INSERT INTO schema_migrations (version) VALUES ('${version}'); COMMIT;`);
    return;
  }
  await db.transaction(async (tx) => {
    await tx.query(sql);
    await tx.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
  });
}

function createPostgresDatabase(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await pool.query(sql, params);
      return { rows: result.rows as T[] };
    },
    async transaction<T>(callback: (tx: Database) => Promise<T>) {
      const client = await pool.connect();
      const tx: Database = {
        async query<R>(sql: string, params: unknown[] = []) {
          const result = await client.query(sql, params);
          return { rows: result.rows as R[] };
        },
        transaction: async <R>(nested: (inner: Database) => Promise<R>) => nested(tx),
        close: async () => undefined
      };
      try {
        await client.query('BEGIN');
        const result = await callback(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); }
  };
}

async function seedDatabase(db: Database) {
  await db.query(
    `INSERT INTO organizations (id, name, slug) VALUES ($1, 'Centro Fashion', 'centro-fashion')
     ON CONFLICT (id) DO NOTHING`,
    [PILOT.organizationId]
  );
  await db.query(
    `INSERT INTO sites (id, organization_id, name, primary_domain, public_key, default_consent_days)
     VALUES ($1, $2, 'QEZ Piloto', 'qez.com.br', $3, 182)
     ON CONFLICT (id) DO NOTHING`,
    [PILOT.siteId, PILOT.organizationId, PILOT.siteKey]
  );
  for (const origin of [
    'http://localhost:3333', 'http://127.0.0.1:3333',
    'http://localhost:3000', 'http://127.0.0.1:3000',
    'https://qez.com.br', 'https://www.qez.com.br'
  ]) {
    await db.query(
      `INSERT INTO site_allowed_origins (organization_id, site_id, origin) VALUES ($1, $2, $3)
       ON CONFLICT (site_id, origin) DO NOTHING`,
      [PILOT.organizationId, PILOT.siteId, origin]
    );
  }
  await db.query(
    `INSERT INTO policy_versions
       (id, organization_id, site_id, revision, status, policy_url, terms_url, content_hash,
        hash_algorithm, content_mime_type, snapshot_schema_version, published_at)
     VALUES ($1, $2, $3, 1, 'published', '/politica-de-privacidade', '/termos', 'pilot-policy-v1',
             'LEGACY-UNVERIFIED', 'text/plain', 1, now())
     ON CONFLICT (id) DO NOTHING`,
    [PILOT.legacyPolicyId, PILOT.organizationId, PILOT.siteId]
  );

  const policySnapshot = canonicalJson(PILOT_POLICY_V2);
  const policyHash = createHash('sha256').update(policySnapshot).digest('hex');
  await db.query(
    `INSERT INTO policy_versions
       (id, organization_id, site_id, revision, status, policy_url, terms_url,
        content_hash, hash_algorithm, content_mime_type, snapshot_schema_version,
        content_snapshot, valid_from, supersedes_id, published_at)
     VALUES ($1, $2, $3, 2, 'published', '/politica-de-privacidade/', NULL,
             $4, 'SHA-256', 'application/vnd.qez.consent-policy+json', 2,
             $5::jsonb, now(), $6, now())
     ON CONFLICT (id) DO NOTHING`,
    [PILOT.policyId, PILOT.organizationId, PILOT.siteId, policyHash, policySnapshot, PILOT.legacyPolicyId]
  );
  await db.query(
    `UPDATE policy_versions
     SET status = 'superseded',
         valid_until = COALESCE(valid_until, (SELECT published_at FROM policy_versions WHERE id = $1))
     WHERE id = $2 AND status = 'published'`,
    [PILOT.policyId, PILOT.legacyPolicyId]
  );
  const categories = [
    ['necessary', 'Cookies estritamente necessários', true, 1],
    ['analytics', 'Desempenho e estatísticas', false, 2],
    ['advertising', 'Publicidade', false, 3]
  ] as const;
  for (const [key, label, required, position] of categories) {
    await db.query(
      `INSERT INTO policy_categories
       (organization_id, site_id, policy_version_id, category_key, label, required, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (policy_version_id, category_key) DO NOTHING`,
      [PILOT.organizationId, PILOT.siteId, PILOT.policyId, key, label, required, position]
    );
  }
  const services = [
    ['analytics', 'google_analytics', 'Google Analytics'],
    ['advertising', 'meta_pixel', 'Meta Pixel']
  ];
  for (const [category, key, label] of services) {
    await db.query(
      `INSERT INTO policy_services
       (organization_id, site_id, policy_version_id, category_key, service_key, label)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (policy_version_id, category_key, service_key) DO NOTHING`,
      [PILOT.organizationId, PILOT.siteId, PILOT.policyId, category, key, label]
    );
  }
}

export { randomUUID };
