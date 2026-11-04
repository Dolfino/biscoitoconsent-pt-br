import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export type QueryResult<T> = { rows: T[] };
export interface Database {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  transaction<T>(callback: (tx: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export const PILOT = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  siteId: '20000000-0000-4000-8000-000000000001',
  policyId: '30000000-0000-4000-8000-000000000001',
  siteKey: 'qez_local_public_key',
  revision: 1
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
  await seedDatabase(db);
  return db;
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
       (id, organization_id, site_id, revision, status, policy_url, terms_url, content_hash, published_at)
     VALUES ($1, $2, $3, 1, 'published', '/politica-de-privacidade', '/termos', 'pilot-policy-v1', now())
     ON CONFLICT (id) DO NOTHING`,
    [PILOT.policyId, PILOT.organizationId, PILOT.siteId]
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
