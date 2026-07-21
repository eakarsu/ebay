import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [741_991]);
    await client.query(`CREATE TABLE IF NOT EXISTS commerce_schema_migrations (
      name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const name of fs.readdirSync(directory).filter((entry) => entry.endsWith('.sql')).sort()) {
      const sql = fs.readFileSync(path.join(directory, name), 'utf8');
      const sha256 = crypto.createHash('sha256').update(sql).digest('hex');
      const applied = await client.query('SELECT sha256 FROM commerce_schema_migrations WHERE name=$1', [name]);
      if (applied.rowCount) {
        if (applied.rows[0].sha256 !== sha256) throw new Error(`Migration checksum changed: ${name}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO commerce_schema_migrations(name, sha256) VALUES($1,$2)', [name, sha256]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [741_991]).catch(() => {});
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().then(() => pool.end()).then(() => console.log('Governed commerce migrations applied')).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
