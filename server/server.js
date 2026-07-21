import crypto from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';
import { pool } from './db.js';
import { loadConfig } from './config.js';
import { authenticate, requireRoles } from './auth.js';
import { canonicalJson, verifyAudit } from './audit.js';
import { createHttpProvider } from './providers.js';
import { verifyPassword } from './password.js';
import {
  applyProviderEvent, approveRefund, cancelOrder, createCatalogItem, createOrder,
  getOrder, listOrders, processNextOperation, reconcileOrder, requestRefund, retryProviderOperation,
} from './orders.js';

const config = loadConfig();

function configuredProviders() {
  const providers = {};
  for (const name of ['inventory', 'tax', 'payment', 'shipping']) {
    const prefix = `PROVIDER_${name.toUpperCase()}`;
    if (process.env[`${prefix}_URL`] && process.env[`${prefix}_TOKEN`]) {
      providers[name] = createHttpProvider({ baseUrl: process.env[`${prefix}_URL`], token: process.env[`${prefix}_TOKEN`] });
    }
  }
  return providers;
}

const buckets = new Map();
function rateLimit(request, response, next) {
  const key = `${request.ip}:${request.path}`;
  const now = Date.now();
  const bucket = buckets.get(key) || { started: now, count: 0 };
  if (now - bucket.started > 60_000) { bucket.started = now; bucket.count = 0; }
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count > 120) return response.status(429).json({ error: 'rate_limited' });
  next();
}

export function createApp({ providers = configuredProviders() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin(origin, callback) { callback(null, !origin || config.origins.includes(origin)); }, credentials: false }));
  app.use(rateLimit);
  app.use(express.json({ limit: '256kb', verify(request, _response, buffer) { request.rawBody = Buffer.from(buffer); } }));

  app.get('/health', async (_request, response, next) => {
    try { await pool.query('SELECT 1'); response.json({ status: 'ok' }); } catch (error) { next(error); }
  });

  app.post('/api/provider-webhooks/:provider', async (request, response, next) => {
    try {
      const timestamp = request.get('x-commerce-timestamp') || '';
      const signature = request.get('x-commerce-signature') || '';
      const timestampMs = Number(timestamp);
      if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) return response.status(401).json({ error: 'stale_signature' });
      const expected = crypto.createHmac('sha256', config.webhookSecret).update(`${timestamp}.`).update(request.rawBody || Buffer.alloc(0)).digest('hex');
      const valid = signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      if (!valid) return response.status(401).json({ error: 'invalid_signature' });
      const body = request.body;
      if (!body?.tenantId || !body?.eventId || !body?.eventType || !body?.payload?.orderId) return response.status(400).json({ error: 'invalid_event' });
      const payloadSha256 = crypto.createHash('sha256').update(canonicalJson(body.payload)).digest('hex');
      const result = await applyProviderEvent({ tenantId: body.tenantId, provider: request.params.provider, eventId: body.eventId, eventType: body.eventType, payload: body.payload, payloadSha256 });
      response.status(result.duplicate ? 200 : 202).json(result);
    } catch (error) { next(error); }
  });

  app.post('/api/auth/login', async (request, response, next) => {
    try {
      const email = String(request.body?.email || '').trim().toLowerCase();
      const password = String(request.body?.password || '');
      const found = await pool.query(
        `SELECT id,tenant_id,email,role,token_version,password_digest
         FROM commerce_identities WHERE email=$1 AND active=true`,
        [email],
      );
      const identity = found.rows[0];
      if (!identity || !verifyPassword(password, identity.password_digest)) {
        return response.status(401).json({ error: 'invalid_credentials' });
      }
      const token = jwt.sign(
        { tenant: identity.tenant_id, role: identity.role, ver: identity.token_version },
        config.jwtSecret,
        { subject: identity.id, issuer: 'governed-commerce', audience: 'commerce-api', algorithm: 'HS256', expiresIn: '2h' },
      );
      return response.json({ token, user: { id: identity.id, tenantId: identity.tenant_id, email: identity.email, role: identity.role } });
    } catch (error) { return next(error); }
  });

  app.use('/api', authenticate);
  app.get('/api/session', (request, response) => response.json({ identity: request.identity }));
  app.get('/api/auth/me', (request, response) => response.json({ user: request.identity }));
  app.post('/api/catalog', requireRoles('merchant', 'operator'), async (request, response, next) => {
    try { response.status(201).json({ item: await createCatalogItem(request.identity, request.body) }); } catch (error) { next(error); }
  });
  app.get('/api/catalog', async (request, response, next) => {
    try {
      const rows = await pool.query(
        `SELECT id, sku, title, unit_price_cents, inventory_on_hand-inventory_reserved available_quantity, version
         FROM commerce_catalog_items WHERE tenant_id=$1 AND active=true ORDER BY title LIMIT 200`, [request.identity.tenantId],
      );
      response.json({ items: rows.rows });
    } catch (error) { next(error); }
  });
  app.post('/api/orders', requireRoles('customer', 'operator'), async (request, response, next) => {
    try {
      const result = await createOrder(request.identity, request.body);
      response.status(result.idempotentReplay ? 200 : 201).json(result);
    } catch (error) { next(error); }
  });
  app.get('/api/orders', async (request, response, next) => {
    try { response.json({ orders: await listOrders(request.identity) }); } catch (error) { next(error); }
  });
  app.get('/api/orders/:id', async (request, response, next) => {
    try {
      const order = await getOrder(request.identity, request.params.id);
      order ? response.json({ order }) : response.status(404).json({ error: 'not_found' });
    } catch (error) { next(error); }
  });
  app.post('/api/orders/:id/cancel', async (request, response, next) => {
    try { response.json({ order: await cancelOrder(request.identity, request.params.id) }); } catch (error) { next(error); }
  });
  app.post('/api/orders/:id/refunds', async (request, response, next) => {
    try { response.status(201).json({ refund: await requestRefund(request.identity, request.params.id, request.body) }); } catch (error) { next(error); }
  });
  app.post('/api/refunds/:id/approve', requireRoles('operator'), async (request, response, next) => {
    try { response.json({ refund: await approveRefund(request.identity, request.params.id) }); } catch (error) { next(error); }
  });
  app.post('/api/operations/process-next', requireRoles('operator'), async (_request, response, next) => {
    try { response.json({ operation: await processNextOperation(providers, `api-${process.pid}`) }); } catch (error) { next(error); }
  });
  app.post('/api/operations/:id/retry', requireRoles('operator'), async (request, response, next) => {
    try { response.json({ operation: await retryProviderOperation(request.identity, request.params.id) }); } catch (error) { next(error); }
  });
  app.post('/api/orders/:id/reconcile', requireRoles('operator', 'auditor'), async (request, response, next) => {
    try { response.json({ reconciliation: await reconcileOrder(request.identity, request.params.id, providers) }); } catch (error) { next(error); }
  });
  app.get('/api/audit', requireRoles('operator', 'auditor'), async (request, response, next) => {
    try {
      const rows = await pool.query('SELECT sequence, actor_id, order_id, action, details, previous_hash, event_hash, created_at FROM commerce_audit_events WHERE tenant_id=$1 ORDER BY sequence DESC LIMIT 500', [request.identity.tenantId]);
      response.json({ verified: await verifyAudit(pool, request.identity.tenantId), events: rows.rows });
    } catch (error) { next(error); }
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof ZodError) return response.status(400).json({ error: 'invalid_request', issues: error.issues.map(({ path, message }) => ({ path, message })) });
    const status = Number(error.status) || (String(error.message).includes('duplicate key') ? 409 : 500);
    const safe = status < 500 ? error.message : 'internal_error';
    if (status >= 500) console.error(JSON.stringify({ event: 'commerce.request_failed', code: error.code || error.message }));
    response.status(status).json({ error: safe });
  });
  return app;
}

const launchedAsEntryPoint = process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (launchedAsEntryPoint) {
  pool.query('SELECT 1 FROM commerce_schema_migrations LIMIT 1').then(() => {
    const port = Number(process.env.PORT || 8080);
    createApp().listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Commerce API listening on ${port}`));
  }).catch(() => {
    console.error('Database schema is missing. Run npm run db:migrate explicitly.');
    process.exitCode = 1;
  });
}
