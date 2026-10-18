import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://modelboard:modelboard@localhost:5432/modelboard',
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
) {
  return pool.query<T>(text, values);
}

export async function runMigrations() {
  const client = await pool.connect();
  try {
    // API and collaboration start together; one session migrates while the other waits.
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended('modelboard:migrations',0))",
    );
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const migrationsUrl = new URL('../migrations/', import.meta.url);
    const files = (await readdir(migrationsUrl))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    for (const version of files) {
      if (
        (
          await client.query(
            'SELECT version FROM schema_migrations WHERE version=$1',
            [version],
          )
        ).rowCount
      )
        continue;
      const sql = await readFile(new URL(version, migrationsUrl), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations(version) VALUES($1)',
          [version],
        );
        await client.query('COMMIT');
        console.log(`Applied database migration: ${version}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    try {
      await client.query(
        "SELECT pg_advisory_unlock(hashtextextended('modelboard:migrations',0))",
      );
    } finally {
      client.release();
    }
  }
}

export {
  relationFromSql,
  validateSqlRelation,
  assertDatasetRelations,
} from './relations.js';
