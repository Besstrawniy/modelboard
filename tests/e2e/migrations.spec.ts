import { test, expect } from '@playwright/test';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
test('API and collaboration can migrate a fresh database concurrently without losing existing data', async () => {
  const connectionString =
    process.env.DATABASE_URL ??
    'postgresql://modelboard:modelboard@localhost:5432/modelboard';
  const admin = new pg.Pool({ connectionString }),
    name = `modelboard_migration_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  let database: pg.Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    database = new pg.Pool({ connectionString: url.toString() });
    await database.query(await readFile('infra/postgres/init.sql', 'utf8'));
    const count = Number(
      (await database.query('SELECT count(*) FROM dataset_rows')).rows[0].count,
    );
    const script =
      'import {runMigrations,pool} from "@modelboard/db"; try{await runMigrations()}finally{await pool.end()}';
    await Promise.all(
      [1, 2].map(() =>
        promisify(execFile)(
          process.execPath,
          ['--import', 'tsx', '--input-type=module', '-e', script],
          {
            cwd: process.cwd(),
            env: { ...process.env, DATABASE_URL: url.toString() },
            timeout: 20000,
          },
        ),
      ),
    );
    expect(
      Number(
        (await database.query('SELECT count(*) FROM schema_migrations')).rows[0]
          .count,
      ),
    ).toBe(
      (await readdir('packages/db/migrations')).filter((file) =>
        file.endsWith('.sql'),
      ).length,
    );
    expect(
      Number(
        (await database.query('SELECT count(*) FROM dataset_rows')).rows[0]
          .count,
      ),
    ).toBe(count);
    expect(
      (
        await database.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='datasets' AND column_name='deleted_at'",
        )
      ).rowCount,
    ).toBe(1);
  } finally {
    await database?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
