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
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const migrationsUrl = new URL('../migrations/', import.meta.url);
  const files = (await readdir(migrationsUrl))
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  for (const version of files) {
    const applied = await pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [version],
    );

    if (applied.rows[0]) continue;

    const sql = await readFile(new URL(version, migrationsUrl), 'utf8');
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version],
      );
      await client.query('COMMIT');
      console.log(`Applied database migration: ${version}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
