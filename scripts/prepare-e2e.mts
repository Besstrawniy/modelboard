import { readFile } from 'node:fs/promises';
import { pool, runMigrations } from '../packages/db/src/index.ts';
try {
  const result = await pool.query("SELECT to_regclass('public.users') IS NOT NULL AS initialized");
  if (!result.rows[0].initialized) await pool.query(await readFile(new URL('../infra/postgres/init.sql', import.meta.url), 'utf8'));
  await runMigrations();
} finally { await pool.end(); }
