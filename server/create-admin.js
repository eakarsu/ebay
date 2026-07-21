import crypto from 'node:crypto';
import { pool, transaction } from './db.js';
import { hashPassword } from './password.js';

async function main() {
  const email = String(process.env.ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
  if (!email || !email.includes('@')) throw new Error('ADMIN_EMAIL must be a valid email address.');
  if (password.length < 12 || password.length > 128) throw new Error('ADMIN_PASSWORD must contain 12-128 characters.');
  await transaction(async (client) => {
    const existing = await client.query('SELECT id FROM commerce_identities WHERE email=$1', [email]);
    if (existing.rowCount) return;
    const tenantId = crypto.randomUUID();
    await client.query(
      'INSERT INTO commerce_tenants(id,slug,name) VALUES($1,$2,$3)',
      [tenantId, `runtime-${tenantId.slice(0, 8)}`, String(process.env.BOOTSTRAP_TENANT_NAME || 'Runtime Acceptance Commerce')],
    );
    await client.query(
      `INSERT INTO commerce_identities(id,tenant_id,email,role,password_digest)
       VALUES($1,$2,$3,'operator',$4)`,
      [crypto.randomUUID(), tenantId, email, hashPassword(password)],
    );
  });
  console.log(`Administrator ${email} is provisioned.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(() => pool.end());
