import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { pool, transaction } from './db.js';
import { loadConfig } from './config.js';

const tenantId = 'aaaaaaaa-0000-4000-8000-000000000001';
const identities = [
  ['aaaaaaaa-1000-4000-8000-000000000001', 'customer@local.test', 'customer'],
  ['aaaaaaaa-2000-4000-8000-000000000001', 'merchant@local.test', 'merchant'],
  ['aaaaaaaa-3000-4000-8000-000000000001', 'operator@local.test', 'operator'],
  ['aaaaaaaa-4000-4000-8000-000000000001', 'auditor@local.test', 'auditor'],
];

export async function seedDevelopment() {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEVELOPMENT_SEED !== 'true') {
    throw new Error('Development seeding requires non-production NODE_ENV and ALLOW_DEVELOPMENT_SEED=true');
  }
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO commerce_tenants(id,slug,name) VALUES($1,'local-demo','Local governed commerce')
       ON CONFLICT (id) DO NOTHING`, [tenantId],
    );
    for (const [id, email, role] of identities) {
      await client.query(
        `INSERT INTO commerce_identities(id,tenant_id,email,role) VALUES($1,$2,$3,$4)
         ON CONFLICT (tenant_id,email) DO UPDATE SET active=true, role=EXCLUDED.role`,
        [id, tenantId, email, role],
      );
    }
    await client.query(
      `INSERT INTO commerce_catalog_items(id,tenant_id,merchant_id,sku,title,unit_price_cents,inventory_on_hand)
       VALUES($1,$2,$3,'GOV-WIDGET','Governed Widget',2500,100)
       ON CONFLICT (tenant_id,sku) DO NOTHING`,
      [crypto.randomUUID(), tenantId, identities[1][0]],
    );
  });
  const config = loadConfig();
  return Object.fromEntries(identities.map(([id, email, role]) => [role, {
    email,
    token: jwt.sign({ tenant: tenantId, role, ver: 1 }, config.jwtSecret, {
      subject: id, issuer: 'governed-commerce', audience: 'commerce-api', algorithm: 'HS256', expiresIn: '2h',
    }),
  }]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedDevelopment().then((tokens) => {
    console.log(JSON.stringify(tokens, null, 2));
  }).then(() => pool.end()).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
