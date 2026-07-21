import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (process.env.NODE_ENV === 'production' && !databaseUrl.startsWith('postgresql://')) {
  throw new Error('Production requires PostgreSQL');
}

export const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: Number(process.env.DB_POOL_MAX || 10),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 10_000),
  application_name: 'governed-commerce-orders',
});

export async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
