import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', '..', 'sql');

async function main() {
  const client = new pg.Client({ connectionString: env.adminDatabaseUrl });
  await client.connect();

  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await client.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    process.stdout.write(`Applying ${file} ... `);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [
        file,
      ]);
      await client.query('COMMIT');
      console.log('done');
      ran += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.log('FAILED');
      throw err;
    }
  }

  console.log(ran ? `${ran} migration(s) applied` : 'Already up to date');
  await client.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
