import { Pool } from 'pg';

/**
 * BFF-side Postgres access (Neon in prod). Song schema: infra/sql/song_schema.sql.
 *
 * Env vars (server-side only, never NEXT_PUBLIC):
 * - DATABASE_URL — Neon connection string (secret).
 */

let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Missing required env var: DATABASE_URL');
    }
    pool = new Pool({
      connectionString,
      // Neon requires TLS; a local docker Postgres may not support it.
      ssl: /sslmode=disable/.test(connectionString)
        ? undefined
        : { rejectUnauthorized: true },
      max: 5,
    });
  }
  return pool;
}
