import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

if (!process.env.PDDL_DATABASE_URL)
  throw new Error('Set PDDL_DATABASE_URL to the designer database.');
const pool = new Pool({ connectionString: process.env.PDDL_DATABASE_URL });
const db = await pool.connect();
try {
  await db.query('BEGIN');
  await db.query("SELECT pg_advisory_xact_lock(hashtext('pddl:migrations'))");
  await db.query(
    'CREATE TABLE IF NOT EXISTS pddl_migrations (version integer PRIMARY KEY)',
  );
  const applied = await db.query(
    'SELECT version FROM pddl_migrations WHERE version = 1',
  );
  if (!applied.rowCount) {
    await db.query(
      await readFile(
        new URL('../migrations/001-runs.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.query('INSERT INTO pddl_migrations(version) VALUES (1)');
  }
  await db.query('COMMIT');
  console.log('Designer schema ready.');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  db.release();
  await pool.end();
}
