import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../db.js';
import { migrate } from '../migrate.js';
import { canonicalJson, verifyAudit } from '../audit.js';
import { ProviderFailure } from '../providers.js';
import {
  applyProviderEvent, approveRefund, cancelOrder, createCatalogItem, createOrder,
  getOrder, processNextOperation, reconcileOrder, requestRefund, retryProviderOperation,
} from '../orders.js';
import { createApp } from '../server.js';

const ids = {
  tenantA: '00000000-0000-4000-8000-000000000001', tenantB: '00000000-0000-4000-8000-000000000002',
  customerA: '10000000-0000-4000-8000-000000000001', customerB: '10000000-0000-4000-8000-000000000002',
  merchantA: '20000000-0000-4000-8000-000000000001', operatorA: '30000000-0000-4000-8000-000000000001',
  auditorA: '40000000-0000-4000-8000-000000000001', itemA: '50000000-0000-4000-8000-000000000001',
};
const customer = { id: ids.customerA, tenantId: ids.tenantA, email: 'customer@a.test', role: 'customer' };
const otherCustomer = { id: ids.customerB, tenantId: ids.tenantB, email: 'customer@b.test', role: 'customer' };
const merchant = { id: ids.merchantA, tenantId: ids.tenantA, email: 'merchant@a.test', role: 'merchant' };
const operator = { id: ids.operatorA, tenantId: ids.tenantA, email: 'operator@a.test', role: 'operator' };
const auditor = { id: ids.auditorA, tenantId: ids.tenantA, email: 'auditor@a.test', role: 'auditor' };

function baseOrder(key = crypto.randomUUID(), quantity = 2) {
  return {
    idempotencyKey: `checkout-${key}`, currency: 'USD', items: [{ sku: 'SKU-1', quantity }],
    shippingAddress: { line1: '1 Market Street', city: 'Boston', region: 'MA', postalCode: '02108', country: 'US' },
  };
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function providers({ payment = 'authorized', inventory = 'reserved' } = {}) {
  return {
    inventory: { execute: vi.fn(async () => ({ status: inventory, ...(inventory === 'reserved' ? { reservationId: 'reservation-1' } : {}) })) },
    tax: { execute: vi.fn(async () => ({ status: 'quoted', taxCents: 125, shippingCents: 500 })) },
    payment: {
      execute: vi.fn(async (operation, payload) => operation === 'payment.refund'
        ? { status: 'accepted', refundId: `provider-${payload.refundId}` }
        : operation === 'payment.void' ? { status: 'voided' }
          : payment === 'authorized' ? { status: 'authorized', paymentId: 'pay-1' } : { status: 'declined', declineCode: 'card_declined' }),
      reconcile: vi.fn(async () => ({ status: 'authorized' })),
    },
    shipping: {
      execute: vi.fn(async () => ({ status: 'accepted', shipmentId: 'ship-1' })),
      reconcile: vi.fn(async () => ({ status: 'in_transit' })),
    },
  };
}

async function seed() {
  await pool.query(`TRUNCATE commerce_fulfillments, commerce_provider_events, commerce_provider_operations,
    commerce_refunds, commerce_order_items, commerce_audit_events, commerce_orders, commerce_catalog_items,
    commerce_identities, commerce_tenants RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO commerce_tenants(id,slug,name) VALUES
    ($1,'tenant-a','Tenant A'),($2,'tenant-b','Tenant B')`, [ids.tenantA, ids.tenantB]);
  await pool.query(`INSERT INTO commerce_identities(id,tenant_id,email,role) VALUES
    ($1,$5,'customer@a.test','customer'),($2,$6,'customer@b.test','customer'),
    ($3,$5,'merchant@a.test','merchant'),($4,$5,'operator@a.test','operator'),
    ($7,$5,'auditor@a.test','auditor')`,
  [ids.customerA, ids.customerB, ids.merchantA, ids.operatorA, ids.tenantA, ids.tenantB, ids.auditorA]);
  await createCatalogItem(merchant, { sku: 'SKU-1', title: 'Governed Widget', unitPriceCents: 2500, inventoryOnHand: 5 });
}

async function runUntilIdle(providerSet, maximum = 10) {
  const states = [];
  for (let index = 0; index < maximum; index += 1) {
    const result = await processNextOperation(providerSet, `test-${index}`);
    if (!result) break;
    states.push(result.state);
  }
  return states;
}

function token(identity) {
  return jwt.sign({ tenant: identity.tenantId, role: identity.role, ver: 1 }, process.env.COMMERCE_JWT_SECRET, {
    subject: identity.id, issuer: 'governed-commerce', audience: 'commerce-api', algorithm: 'HS256', expiresIn: '5m',
  });
}

beforeAll(async () => { await migrate(); await migrate(); });
beforeEach(seed);
afterAll(async () => { await pool.end(); });

describe('governed commerce workflow on PostgreSQL', () => {
  it('replays checksum-verified migrations without duplicating the ledger', async () => {
    await migrate();
    expect(Number((await pool.query('SELECT count(*) count FROM commerce_schema_migrations')).rows[0].count)).toBe(2);
  });

  it('prevents overselling under concurrent reservations', async () => {
    const results = await Promise.allSettled([
      createOrder(customer, baseOrder('oversell-a', 4)),
      createOrder(customer, baseOrder('oversell-b', 4)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const item = (await pool.query("SELECT inventory_reserved FROM commerce_catalog_items WHERE sku='SKU-1'")).rows[0];
    expect(item.inventory_reserved).toBe(4);
  });

  it('replays identical checkout idempotently and rejects changed input', async () => {
    const first = await createOrder(customer, baseOrder('idem-1', 1));
    const replay = await createOrder(customer, baseOrder('idem-1', 1));
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.order.id).toBe(first.order.id);
    await expect(createOrder(customer, baseOrder('idem-1', 2))).rejects.toThrow('idempotency_conflict');
  });

  it('moves a reserved order through tax, payment, and shipment creation', async () => {
    const created = await createOrder(customer, baseOrder('happy-path'));
    expect(await runUntilIdle(providers())).toEqual(['succeeded', 'succeeded', 'succeeded', 'succeeded']);
    const order = await getOrder(customer, created.order.id);
    expect(order.state).toBe('paid');
    expect(order.tax_cents).toBe(125);
    expect(order.total_cents).toBe(5625);
    expect(order.operations).toHaveLength(4);
  });

  it('fails closed and releases inventory after a payment decline', async () => {
    const created = await createOrder(customer, baseOrder('declined', 3));
    await runUntilIdle(providers({ payment: 'declined' }));
    expect((await getOrder(customer, created.order.id)).state).toBe('exception');
    expect((await pool.query("SELECT inventory_reserved FROM commerce_catalog_items WHERE sku='SKU-1'")).rows[0].inventory_reserved).toBe(0);
  });

  it('applies partial fulfillment exactly once across duplicate webhooks', async () => {
    const created = await createOrder(customer, baseOrder('partial', 2));
    await runUntilIdle(providers());
    const payload = { orderId: created.order.id, trackingNumber: 'TRACK-1', items: [{ sku: 'SKU-1', quantity: 1 }] };
    const args = { tenantId: ids.tenantA, provider: 'shipping', eventId: 'ship-event-1', eventType: 'shipping.partial', payload, payloadSha256: payloadHash(payload) };
    expect((await applyProviderEvent(args)).duplicate).toBe(false);
    expect((await applyProviderEvent(args)).duplicate).toBe(true);
    const order = await getOrder(customer, created.order.id);
    expect(order.state).toBe('partially_fulfilled');
    expect(order.items[0].fulfilled_quantity).toBe(1);
  });

  it('cancels before payment and releases the reservation without a provider write', async () => {
    const created = await createOrder(customer, baseOrder('cancel', 2));
    expect((await cancelOrder(customer, created.order.id)).state).toBe('cancelled');
    expect((await pool.query("SELECT inventory_reserved FROM commerce_catalog_items WHERE sku='SKU-1'")).rows[0].inventory_reserved).toBe(0);
  });

  it('requires independent operator approval and idempotent provider refund handling', async () => {
    const created = await createOrder(customer, baseOrder('refund', 1));
    const providerSet = providers();
    await runUntilIdle(providerSet);
    const payload = { orderId: created.order.id, items: [{ sku: 'SKU-1', quantity: 1 }] };
    await applyProviderEvent({ tenantId: ids.tenantA, provider: 'shipping', eventId: 'fulfilled-1', eventType: 'shipping.fulfilled', payload, payloadSha256: payloadHash(payload) });
    const refund = await requestRefund(customer, created.order.id, { amountCents: 3125, reason: 'Item did not match listing' });
    await expect(approveRefund(customer, refund.id)).rejects.toThrow('forbidden');
    expect((await approveRefund(operator, refund.id)).state).toBe('approved');
    expect((await processNextOperation(providerSet)).state).toBe('succeeded');
    const refundPayload = { orderId: created.order.id, refundId: refund.id, providerRefundId: 'refund-provider-1' };
    const event = { tenantId: ids.tenantA, provider: 'payment', eventId: 'refund-1', eventType: 'refund.succeeded', payload: refundPayload, payloadSha256: payloadHash(refundPayload) };
    await applyProviderEvent(event);
    await applyProviderEvent(event);
    expect((await getOrder(customer, created.order.id)).state).toBe('refunded');
  });

  it('enforces tenant/customer isolation through live HTTP routes', async () => {
    const created = await createOrder(customer, baseOrder('tenant-http', 1));
    const app = createApp({ providers: providers() });
    await request(app).get(`/api/orders/${created.order.id}`).set('authorization', `Bearer ${token(otherCustomer)}`).expect(404);
    const own = await request(app).get(`/api/orders/${created.order.id}`).set('authorization', `Bearer ${token(customer)}`).expect(200);
    expect(own.body.order.id).toBe(created.order.id);
  });

  it('rejects unsigned webhooks, deduplicates signed delivery, reconciles drift, and protects audit history', async () => {
    const created = await createOrder(customer, baseOrder('webhook-audit', 1));
    await runUntilIdle(providers());
    const app = createApp({ providers: providers() });
    const body = { tenantId: ids.tenantA, eventId: 'http-event-1', eventType: 'shipping.fulfilled', payload: { orderId: created.order.id, items: [{ sku: 'SKU-1', quantity: 1 }] } };
    await request(app).post('/api/provider-webhooks/shipping').send(body).expect(401);
    const timestamp = String(Date.now());
    const signature = crypto.createHmac('sha256', process.env.PROVIDER_WEBHOOK_SECRET).update(`${timestamp}.${JSON.stringify(body)}`).digest('hex');
    await request(app).post('/api/provider-webhooks/shipping').set('x-commerce-timestamp', timestamp).set('x-commerce-signature', signature).send(body).expect(202);
    await request(app).post('/api/provider-webhooks/shipping').set('x-commerce-timestamp', timestamp).set('x-commerce-signature', signature).send(body).expect(200);
    const reconciliation = await reconcileOrder(auditor, created.order.id, { payment: { reconcile: async () => ({ status: 'missing' }) }, shipping: { reconcile: async () => ({ status: 'missing' }) } });
    expect(reconciliation.consistent).toBe(false);
    expect(await verifyAudit(pool, ids.tenantA)).toBe(true);
    await expect(pool.query('DELETE FROM commerce_audit_events WHERE tenant_id=$1', [ids.tenantA])).rejects.toThrow(/append-only/);
  });

  it('holds ambiguous provider outcomes for reconciliation instead of retrying a write', async () => {
    const created = await createOrder(customer, baseOrder('unknown', 1));
    const providerSet = providers();
    providerSet.inventory.execute = async () => { throw new ProviderFailure('network_unknown', true, true); };
    expect((await processNextOperation(providerSet)).state).toBe('pending_unknown');
    expect((await getOrder(customer, created.order.id)).state).toBe('reservation_pending');
    expect(Number((await pool.query("SELECT count(*) count FROM commerce_provider_operations WHERE state='pending_unknown'")).rows[0].count)).toBe(1);
  });

  it('requires an operator to explicitly recover an ambiguous idempotent operation', async () => {
    await createOrder(customer, baseOrder('recover-unknown', 1));
    const uncertain = providers();
    uncertain.inventory.execute = async () => { throw new ProviderFailure('network_unknown', true, true); };
    await processNextOperation(uncertain);
    const operation = (await pool.query("SELECT id FROM commerce_provider_operations WHERE state='pending_unknown'")).rows[0];
    await expect(retryProviderOperation(customer, operation.id)).rejects.toThrow('forbidden');
    expect((await retryProviderOperation(operator, operation.id)).state).toBe('retry');
    expect((await processNextOperation(providers())).state).toBe('succeeded');
  });
});
