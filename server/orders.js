import crypto from 'node:crypto';
import { z } from 'zod';
import { pool, transaction } from './db.js';
import { appendAudit, canonicalJson } from './audit.js';
import { ProviderFailure, validateProviderResult } from './providers.js';

const addressSchema = z.object({
  line1: z.string().trim().min(3).max(120), line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2).max(80), region: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().min(3).max(20), country: z.string().trim().regex(/^[A-Z]{2}$/),
}).strict();
const orderSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(100), currency: z.string().trim().regex(/^[A-Z]{3}$/),
  shippingAddress: addressSchema,
  items: z.array(z.object({ sku: z.string().trim().min(1).max(80), quantity: z.number().int().min(1).max(100) }).strict()).min(1).max(50),
}).strict();
const catalogSchema = z.object({
  sku: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(180),
  unitPriceCents: z.number().int().positive().max(100_000_000), inventoryOnHand: z.number().int().nonnegative().max(10_000_000),
}).strict();

function sha(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

async function queueOperation(client, { tenantId, orderId, provider, operation, idempotencyKey, request }) {
  const id = crypto.randomUUID();
  const result = await client.query(
    `INSERT INTO commerce_provider_operations
      (id, tenant_id, order_id, provider, operation, idempotency_key, request)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (tenant_id, provider, idempotency_key) DO UPDATE
       SET idempotency_key=EXCLUDED.idempotency_key
     RETURNING *`,
    [id, tenantId, orderId, provider, operation, idempotencyKey, canonicalJson(request)],
  );
  return result.rows[0];
}

async function releaseInventory(client, tenantId, orderId) {
  const items = (await client.query(
    `SELECT id, catalog_item_id, reserved_quantity, fulfilled_quantity
     FROM commerce_order_items WHERE tenant_id=$1 AND order_id=$2 FOR UPDATE`, [tenantId, orderId],
  )).rows;
  for (const item of items) {
    const releasable = Math.max(0, item.reserved_quantity - item.fulfilled_quantity);
    if (!releasable) continue;
    await client.query(
      `UPDATE commerce_catalog_items SET inventory_reserved=inventory_reserved-$1, version=version+1, updated_at=now()
       WHERE tenant_id=$2 AND id=$3`, [releasable, tenantId, item.catalog_item_id],
    );
    await client.query('UPDATE commerce_order_items SET reserved_quantity=fulfilled_quantity WHERE id=$1', [item.id]);
  }
}

export async function createCatalogItem(identity, input) {
  if (!['merchant', 'operator'].includes(identity.role)) throw Object.assign(new Error('forbidden'), { status: 403 });
  const value = catalogSchema.parse(input);
  const id = crypto.randomUUID();
  return transaction(async (client) => {
    const row = (await client.query(
      `INSERT INTO commerce_catalog_items
        (id, tenant_id, merchant_id, sku, title, unit_price_cents, inventory_on_hand)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, identity.tenantId, identity.id, value.sku, value.title, value.unitPriceCents, value.inventoryOnHand],
    )).rows[0];
    await appendAudit(client, { tenantId: identity.tenantId, actorId: identity.id, action: 'catalog.item_created', details: { catalogItemId: id, sku: value.sku, inventoryOnHand: value.inventoryOnHand } });
    return row;
  });
}

export async function createOrder(identity, input) {
  if (!['customer', 'operator'].includes(identity.role)) throw Object.assign(new Error('forbidden'), { status: 403 });
  const value = orderSchema.parse(input);
  const requestHash = sha(value);
  return transaction(async (client) => {
    const replay = await client.query(
      `SELECT * FROM commerce_orders WHERE tenant_id=$1 AND customer_id=$2 AND idempotency_key=$3 FOR UPDATE`,
      [identity.tenantId, identity.id, value.idempotencyKey],
    );
    if (replay.rowCount) {
      if (replay.rows[0].request_sha256 !== requestHash) throw Object.assign(new Error('idempotency_conflict'), { status: 409 });
      return { order: replay.rows[0], idempotentReplay: true };
    }
    const bySku = new Map();
    for (const item of value.items) {
      if (bySku.has(item.sku)) throw Object.assign(new Error('duplicate_sku'), { status: 400 });
      bySku.set(item.sku, item.quantity);
    }
    const catalog = (await client.query(
      `SELECT * FROM commerce_catalog_items
       WHERE tenant_id=$1 AND sku=ANY($2::text[]) AND active=true ORDER BY sku FOR UPDATE`,
      [identity.tenantId, [...bySku.keys()].sort()],
    )).rows;
    if (catalog.length !== bySku.size) throw Object.assign(new Error('catalog_item_unavailable'), { status: 409 });
    let subtotal = 0;
    for (const item of catalog) {
      const quantity = bySku.get(item.sku);
      if (item.inventory_on_hand - item.inventory_reserved < quantity) throw Object.assign(new Error(`insufficient_inventory:${item.sku}`), { status: 409 });
      subtotal += item.unit_price_cents * quantity;
    }
    const orderId = crypto.randomUUID();
    const order = (await client.query(
      `INSERT INTO commerce_orders
        (id, tenant_id, customer_id, idempotency_key, request_sha256, state, currency, subtotal_cents, total_cents, shipping_address)
       VALUES($1,$2,$3,$4,$5,'reservation_pending',$6,$7,$7,$8::jsonb) RETURNING *`,
      [orderId, identity.tenantId, identity.id, value.idempotencyKey, requestHash, value.currency, subtotal, canonicalJson(value.shippingAddress)],
    )).rows[0];
    for (const item of catalog) {
      const quantity = bySku.get(item.sku);
      await client.query(
        `INSERT INTO commerce_order_items
          (id, tenant_id, order_id, catalog_item_id, sku, title, unit_price_cents, quantity, reserved_quantity)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
        [crypto.randomUUID(), identity.tenantId, orderId, item.id, item.sku, item.title, item.unit_price_cents, quantity],
      );
      await client.query(
        `UPDATE commerce_catalog_items SET inventory_reserved=inventory_reserved+$1, version=version+1, updated_at=now()
         WHERE tenant_id=$2 AND id=$3`, [quantity, identity.tenantId, item.id],
      );
    }
    await queueOperation(client, {
      tenantId: identity.tenantId, orderId, provider: 'inventory', operation: 'inventory.reserve',
      idempotencyKey: `order:${orderId}:inventory:reserve:v1`,
      request: { orderId, items: catalog.map((item) => ({ sku: item.sku, quantity: bySku.get(item.sku) })) },
    });
    await appendAudit(client, { tenantId: identity.tenantId, actorId: identity.id, orderId, action: 'order.created', details: { subtotalCents: subtotal, currency: value.currency, requestHash } });
    return { order, idempotentReplay: false };
  });
}

export async function getOrder(identity, orderId) {
  const customerFilter = identity.role === 'customer' ? 'AND customer_id=$3' : '';
  const parameters = identity.role === 'customer' ? [identity.tenantId, orderId, identity.id] : [identity.tenantId, orderId];
  const order = await pool.query(`SELECT * FROM commerce_orders WHERE tenant_id=$1 AND id=$2 ${customerFilter}`, parameters);
  if (!order.rowCount) return null;
  const [items, operations, refunds] = await Promise.all([
    pool.query('SELECT * FROM commerce_order_items WHERE tenant_id=$1 AND order_id=$2 ORDER BY sku', [identity.tenantId, orderId]),
    pool.query('SELECT provider, operation, state, attempts, last_error_code, updated_at FROM commerce_provider_operations WHERE tenant_id=$1 AND order_id=$2 ORDER BY created_at', [identity.tenantId, orderId]),
    pool.query('SELECT id, amount_cents, reason, state, created_at FROM commerce_refunds WHERE tenant_id=$1 AND order_id=$2 ORDER BY created_at', [identity.tenantId, orderId]),
  ]);
  return { ...order.rows[0], items: items.rows, operations: operations.rows, refunds: refunds.rows };
}

export async function listOrders(identity) {
  const parameters = [identity.tenantId];
  let filter = '';
  if (identity.role === 'customer') { filter = 'AND customer_id=$2'; parameters.push(identity.id); }
  return (await pool.query(`SELECT * FROM commerce_orders WHERE tenant_id=$1 ${filter} ORDER BY created_at DESC LIMIT 100`, parameters)).rows;
}

async function applySuccessfulOperation(client, operation, result) {
  const order = (await client.query('SELECT * FROM commerce_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [operation.tenant_id, operation.order_id])).rows[0];
  if (!order) throw new Error('order_not_found');
  const expectedStates = {
    'inventory.reserve': ['reservation_pending'],
    'tax.quote': ['reservation_pending'],
    'payment.authorize': ['awaiting_payment'],
    'payment.void': ['cancel_pending'],
    'payment.refund': ['refund_pending'],
    'shipping.create': ['paid'],
  };
  if (!expectedStates[operation.operation]?.includes(order.state)) {
    await appendAudit(client, {
      tenantId: order.tenant_id,
      actorId: order.customer_id,
      orderId: order.id,
      action: 'provider.operation_ignored',
      details: { operationId: operation.id, operation: operation.operation, orderState: order.state },
    });
    return;
  }
  if (operation.operation === 'inventory.reserve') {
    if (result.status === 'unavailable') {
      await releaseInventory(client, operation.tenant_id, operation.order_id);
      await client.query("UPDATE commerce_orders SET state='exception', failure_code='external_inventory_unavailable', version=version+1, updated_at=now() WHERE id=$1", [order.id]);
    } else {
      await queueOperation(client, { tenantId: order.tenant_id, orderId: order.id, provider: 'tax', operation: 'tax.quote', idempotencyKey: `order:${order.id}:tax:quote:v1`, request: { orderId: order.id, subtotalCents: order.subtotal_cents, currency: order.currency, shippingAddress: order.shipping_address } });
    }
  } else if (operation.operation === 'tax.quote') {
    const total = order.subtotal_cents + result.taxCents + result.shippingCents;
    await client.query("UPDATE commerce_orders SET tax_cents=$1, shipping_cents=$2, total_cents=$3, state='awaiting_payment', version=version+1, updated_at=now() WHERE id=$4", [result.taxCents, result.shippingCents, total, order.id]);
    await queueOperation(client, { tenantId: order.tenant_id, orderId: order.id, provider: 'payment', operation: 'payment.authorize', idempotencyKey: `order:${order.id}:payment:authorize:v1`, request: { orderId: order.id, amountCents: total, currency: order.currency } });
  } else if (operation.operation === 'payment.authorize') {
    if (result.status === 'declined') {
      await releaseInventory(client, order.tenant_id, order.id);
      await client.query("UPDATE commerce_orders SET state='exception', failure_code=$1, version=version+1, updated_at=now() WHERE id=$2", [result.declineCode || 'payment_declined', order.id]);
    } else {
      await client.query("UPDATE commerce_orders SET state='paid', provider_payment_id=$1, failure_code=NULL, version=version+1, updated_at=now() WHERE id=$2", [result.paymentId, order.id]);
      await queueOperation(client, { tenantId: order.tenant_id, orderId: order.id, provider: 'shipping', operation: 'shipping.create', idempotencyKey: `order:${order.id}:shipping:create:v1`, request: { orderId: order.id, shippingAddress: order.shipping_address } });
    }
  } else if (operation.operation === 'payment.void') {
    await releaseInventory(client, order.tenant_id, order.id);
    await client.query("UPDATE commerce_orders SET state='cancelled', version=version+1, updated_at=now() WHERE id=$1", [order.id]);
  } else if (operation.operation === 'payment.refund') {
    const refundId = operation.request.refundId;
    if (result.status === 'declined') {
      await client.query("UPDATE commerce_refunds SET state='failed', updated_at=now() WHERE tenant_id=$1 AND id=$2", [order.tenant_id, refundId]);
      await client.query("UPDATE commerce_orders SET state='exception', failure_code='refund_declined', updated_at=now() WHERE id=$1", [order.id]);
    } else {
      await client.query("UPDATE commerce_refunds SET state='processing', provider_refund_id=$1, updated_at=now() WHERE tenant_id=$2 AND id=$3", [result.refundId, order.tenant_id, refundId]);
    }
  }
  const actorId = order.customer_id;
  await appendAudit(client, { tenantId: order.tenant_id, actorId, orderId: order.id, action: 'provider.operation_succeeded', details: { provider: operation.provider, operation: operation.operation, operationId: operation.id, outcome: result.status } });
}

export async function processNextOperation(providers, workerId = 'local-worker') {
  const claimed = await transaction(async (client) => {
    const operation = (await client.query(
      `SELECT * FROM commerce_provider_operations
       WHERE (state IN ('queued','retry') AND next_attempt_at<=now())
          OR (state='processing' AND lease_expires_at<now())
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
    )).rows[0];
    if (!operation) return null;
    await client.query(
      `UPDATE commerce_provider_operations SET state='processing', attempts=attempts+1,
       lease_owner=$1, lease_expires_at=now()+interval '30 seconds', updated_at=now() WHERE id=$2`, [workerId, operation.id],
    );
    return { ...operation, attempts: operation.attempts + 1 };
  });
  if (!claimed) return null;
  try {
    const provider = providers[claimed.provider];
    if (!provider?.execute) throw new ProviderFailure('provider_not_configured', false);
    const result = validateProviderResult(claimed.operation, await provider.execute(claimed.operation, claimed.request, claimed.idempotency_key));
    await transaction(async (client) => {
      await client.query("UPDATE commerce_provider_operations SET state='succeeded', response=$1::jsonb, lease_owner=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=$2", [canonicalJson(result), claimed.id]);
      await applySuccessfulOperation(client, claimed, result);
    });
    return { id: claimed.id, state: 'succeeded' };
  } catch (error) {
    const failure = error instanceof ProviderFailure ? error : new ProviderFailure('provider_internal_error', true);
    let state = failure.ambiguous ? 'pending_unknown' : failure.retryable && claimed.attempts < 5 ? 'retry' : 'dead_letter';
    await transaction(async (client) => {
      const order = (await client.query('SELECT * FROM commerce_orders WHERE id=$1 FOR UPDATE', [claimed.order_id])).rows[0];
      const stale = ['cancelled', 'refunded'].includes(order.state)
        || (order.state === 'cancel_pending' && claimed.operation !== 'payment.void');
      if (stale) state = 'dead_letter';
      await client.query(
        `UPDATE commerce_provider_operations SET state=$1, last_error_code=$2,
         next_attempt_at=now()+make_interval(secs => LEAST(300, power(2, attempts)::integer)),
         lease_owner=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=$3`,
        [state, stale ? 'operation_obsolete' : failure.code, claimed.id],
      );
      if (state === 'dead_letter' && !stale) await client.query("UPDATE commerce_orders SET state='exception', failure_code=$1, version=version+1, updated_at=now() WHERE id=$2", [failure.code, order.id]);
      await appendAudit(client, { tenantId: order.tenant_id, actorId: order.customer_id, orderId: order.id, action: stale ? 'provider.operation_ignored' : 'provider.operation_failed', details: { operationId: claimed.id, code: stale ? 'operation_obsolete' : failure.code, state } });
    });
    return { id: claimed.id, state, code: failure.code };
  }
}

export async function cancelOrder(identity, orderId) {
  if (!['customer', 'operator'].includes(identity.role)) throw Object.assign(new Error('forbidden'), { status: 403 });
  return transaction(async (client) => {
    const order = (await client.query('SELECT * FROM commerce_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [identity.tenantId, orderId])).rows[0];
    if (!order || (identity.role === 'customer' && order.customer_id !== identity.id)) throw Object.assign(new Error('not_found'), { status: 404 });
    if (['fulfilled', 'partially_fulfilled', 'refunded'].includes(order.state)) throw Object.assign(new Error('refund_required'), { status: 409 });
    if (['cancelled', 'cancel_pending'].includes(order.state)) return order;
    if (order.provider_payment_id) {
      await client.query(
        `UPDATE commerce_provider_operations SET state='dead_letter', last_error_code='order_cancelled', updated_at=now()
         WHERE tenant_id=$1 AND order_id=$2 AND state IN ('queued','retry')`,
        [order.tenant_id, order.id],
      );
      await client.query("UPDATE commerce_orders SET state='cancel_pending', version=version+1, updated_at=now() WHERE id=$1", [order.id]);
      await queueOperation(client, { tenantId: order.tenant_id, orderId: order.id, provider: 'payment', operation: 'payment.void', idempotencyKey: `order:${order.id}:payment:void:v1`, request: { orderId: order.id, paymentId: order.provider_payment_id } });
    } else {
      await client.query(
        `UPDATE commerce_provider_operations SET state='dead_letter', last_error_code='order_cancelled', updated_at=now()
         WHERE tenant_id=$1 AND order_id=$2 AND state IN ('queued','retry')`,
        [order.tenant_id, order.id],
      );
      await releaseInventory(client, order.tenant_id, order.id);
      await client.query("UPDATE commerce_orders SET state='cancelled', version=version+1, updated_at=now() WHERE id=$1", [order.id]);
    }
    await appendAudit(client, { tenantId: order.tenant_id, actorId: identity.id, orderId: order.id, action: 'order.cancel_requested', details: { priorState: order.state } });
    return (await client.query('SELECT * FROM commerce_orders WHERE id=$1', [order.id])).rows[0];
  });
}

export async function requestRefund(identity, orderId, input) {
  if (!['customer', 'operator'].includes(identity.role)) throw Object.assign(new Error('forbidden'), { status: 403 });
  const value = z.object({ amountCents: z.number().int().positive(), reason: z.string().trim().min(8).max(500) }).strict().parse(input);
  return transaction(async (client) => {
    const order = (await client.query('SELECT * FROM commerce_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [identity.tenantId, orderId])).rows[0];
    if (!order || (identity.role === 'customer' && order.customer_id !== identity.id)) throw Object.assign(new Error('not_found'), { status: 404 });
    if (!['paid', 'partially_fulfilled', 'fulfilled'].includes(order.state)) throw Object.assign(new Error('order_not_refundable'), { status: 409 });
    const prior = Number((await client.query("SELECT COALESCE(sum(amount_cents),0) amount FROM commerce_refunds WHERE tenant_id=$1 AND order_id=$2 AND state NOT IN ('failed')", [identity.tenantId, orderId])).rows[0].amount);
    if (prior + value.amountCents > order.total_cents) throw Object.assign(new Error('refund_exceeds_order_total'), { status: 409 });
    const refund = (await client.query(
      `INSERT INTO commerce_refunds(id, tenant_id, order_id, requested_by, amount_cents, reason, state)
       VALUES($1,$2,$3,$4,$5,$6,'requested') RETURNING *`,
      [crypto.randomUUID(), identity.tenantId, orderId, identity.id, value.amountCents, value.reason],
    )).rows[0];
    await appendAudit(client, { tenantId: identity.tenantId, actorId: identity.id, orderId, action: 'refund.requested', details: { refundId: refund.id, amountCents: value.amountCents, reason: value.reason } });
    return refund;
  });
}

export async function approveRefund(identity, refundId) {
  if (identity.role !== 'operator') throw Object.assign(new Error('forbidden'), { status: 403 });
  return transaction(async (client) => {
    const refund = (await client.query('SELECT * FROM commerce_refunds WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [identity.tenantId, refundId])).rows[0];
    if (!refund) throw Object.assign(new Error('not_found'), { status: 404 });
    if (refund.requested_by === identity.id) throw Object.assign(new Error('independent_approval_required'), { status: 409 });
    if (refund.state !== 'requested') return refund;
    const order = (await client.query('SELECT * FROM commerce_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [identity.tenantId, refund.order_id])).rows[0];
    await client.query("UPDATE commerce_refunds SET state='approved', approved_by=$1, updated_at=now() WHERE id=$2", [identity.id, refund.id]);
    await client.query("UPDATE commerce_orders SET state='refund_pending', version=version+1, updated_at=now() WHERE id=$1", [order.id]);
    await queueOperation(client, { tenantId: order.tenant_id, orderId: order.id, provider: 'payment', operation: 'payment.refund', idempotencyKey: `order:${order.id}:refund:${refund.id}:v1`, request: { orderId: order.id, paymentId: order.provider_payment_id, refundId: refund.id, amountCents: refund.amount_cents } });
    await appendAudit(client, { tenantId: identity.tenantId, actorId: identity.id, orderId: order.id, action: 'refund.approved', details: { refundId: refund.id, amountCents: refund.amount_cents } });
    return (await client.query('SELECT * FROM commerce_refunds WHERE id=$1', [refund.id])).rows[0];
  });
}

export async function retryProviderOperation(identity, operationId) {
  if (identity.role !== 'operator') throw Object.assign(new Error('forbidden'), { status: 403 });
  return transaction(async (client) => {
    const operation = (await client.query(
      `SELECT operation.* FROM commerce_provider_operations operation
       JOIN commerce_orders orders ON orders.id=operation.order_id AND orders.tenant_id=operation.tenant_id
       WHERE operation.tenant_id=$1 AND operation.id=$2 FOR UPDATE OF operation`,
      [identity.tenantId, operationId],
    )).rows[0];
    if (!operation) throw Object.assign(new Error('not_found'), { status: 404 });
    if (!['pending_unknown', 'dead_letter'].includes(operation.state)) {
      throw Object.assign(new Error('operation_not_recoverable'), { status: 409 });
    }
    const order = (await client.query(
      'SELECT * FROM commerce_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
      [identity.tenantId, operation.order_id],
    )).rows[0];
    if (['cancelled', 'refunded'].includes(order.state)) throw Object.assign(new Error('terminal_order'), { status: 409 });
    await client.query(
      `UPDATE commerce_provider_operations SET state='retry', next_attempt_at=now(),
       last_error_code=NULL, lease_owner=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=$1`,
      [operation.id],
    );
    await appendAudit(client, {
      tenantId: identity.tenantId,
      actorId: identity.id,
      orderId: order.id,
      action: 'provider.operation_requeued',
      details: { operationId: operation.id, priorState: operation.state, idempotencyKey: operation.idempotency_key },
    });
    return { ...operation, state: 'retry', last_error_code: null };
  });
}

async function applyFulfillment(client, event, order) {
  const requested = z.array(z.object({ sku: z.string(), quantity: z.number().int().positive() })).min(1).parse(event.payload.items);
  for (const incoming of requested) {
    const item = (await client.query('SELECT * FROM commerce_order_items WHERE tenant_id=$1 AND order_id=$2 AND sku=$3 FOR UPDATE', [order.tenant_id, order.id, incoming.sku])).rows[0];
    if (!item || item.fulfilled_quantity + incoming.quantity > item.quantity) throw new Error('invalid_fulfillment_quantity');
    await client.query('UPDATE commerce_order_items SET fulfilled_quantity=fulfilled_quantity+$1 WHERE id=$2', [incoming.quantity, item.id]);
    await client.query(
      `UPDATE commerce_catalog_items SET inventory_on_hand=inventory_on_hand-$1,
       inventory_reserved=inventory_reserved-$1, version=version+1, updated_at=now()
       WHERE tenant_id=$2 AND id=$3`, [incoming.quantity, order.tenant_id, item.catalog_item_id],
    );
  }
  await client.query(
    `INSERT INTO commerce_fulfillments(id, tenant_id, order_id, provider_event_id, tracking_number, items)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [crypto.randomUUID(), order.tenant_id, order.id, event.id, event.payload.trackingNumber || null, canonicalJson(requested)],
  );
  const remaining = Number((await client.query('SELECT sum(quantity-fulfilled_quantity) count FROM commerce_order_items WHERE order_id=$1', [order.id])).rows[0].count);
  await client.query("UPDATE commerce_orders SET state=$1, version=version+1, updated_at=now() WHERE id=$2", [remaining === 0 ? 'fulfilled' : 'partially_fulfilled', order.id]);
}

export async function applyProviderEvent({ tenantId, provider, eventId, eventType, payload, payloadSha256 }) {
  const expectedPayloadSha256 = crypto.createHash('sha256').update(canonicalJson(payload)).digest('hex');
  if (payloadSha256 !== expectedPayloadSha256) throw Object.assign(new Error('payload_hash_mismatch'), { status: 400 });
  return transaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO commerce_provider_events(id, tenant_id, provider, event_id, event_type, payload, payload_sha256)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT (tenant_id, provider, event_id) DO NOTHING RETURNING *`,
      [crypto.randomUUID(), tenantId, provider, eventId, eventType, canonicalJson(payload), payloadSha256],
    );
    if (!inserted.rowCount) return { duplicate: true };
    const event = inserted.rows[0];
    const order = (await client.query('SELECT * FROM commerce_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenantId, payload.orderId])).rows[0];
    if (!order) throw new Error('order_not_found');
    if (eventType === 'payment.failed') {
      await releaseInventory(client, tenantId, order.id);
      await client.query("UPDATE commerce_orders SET state='exception', failure_code=$1, version=version+1, updated_at=now() WHERE id=$2", [payload.code || 'payment_failed', order.id]);
    } else if (eventType === 'payment.authorized' && !['paid', 'partially_fulfilled', 'fulfilled'].includes(order.state)) {
      await client.query("UPDATE commerce_orders SET state='paid', provider_payment_id=$1, failure_code=NULL, version=version+1, updated_at=now() WHERE id=$2", [payload.paymentId, order.id]);
      await queueOperation(client, { tenantId, orderId: order.id, provider: 'shipping', operation: 'shipping.create', idempotencyKey: `order:${order.id}:shipping:create:v1`, request: { orderId: order.id, shippingAddress: order.shipping_address } });
    } else if (eventType === 'shipping.partial' || eventType === 'shipping.fulfilled') {
      await applyFulfillment(client, event, order);
    } else if (eventType === 'refund.succeeded') {
      const refund = (await client.query('SELECT * FROM commerce_refunds WHERE tenant_id=$1 AND id=$2 AND order_id=$3 FOR UPDATE', [tenantId, payload.refundId, order.id])).rows[0];
      if (!refund) throw new Error('refund_not_found');
      await client.query("UPDATE commerce_refunds SET state='succeeded', provider_refund_id=COALESCE(provider_refund_id,$1), updated_at=now() WHERE id=$2", [payload.providerRefundId || null, refund.id]);
      const refunded = Number((await client.query("SELECT COALESCE(sum(amount_cents),0) amount FROM commerce_refunds WHERE order_id=$1 AND state='succeeded'", [order.id])).rows[0].amount);
      const fulfilled = Number((await client.query('SELECT COALESCE(sum(fulfilled_quantity),0) count FROM commerce_order_items WHERE order_id=$1', [order.id])).rows[0].count);
      await client.query('UPDATE commerce_orders SET state=$1, version=version+1, updated_at=now() WHERE id=$2', [refunded >= order.total_cents ? 'refunded' : fulfilled > 0 ? 'partially_fulfilled' : 'paid', order.id]);
    } else {
      throw new Error('unsupported_event_type');
    }
    await client.query('UPDATE commerce_provider_events SET handled_at=now() WHERE id=$1', [event.id]);
    await appendAudit(client, { tenantId, actorId: order.customer_id, orderId: order.id, action: 'provider.event_applied', details: { provider, eventId, eventType, payloadSha256 } });
    return { duplicate: false, eventId: event.id };
  });
}

export async function reconcileOrder(identity, orderId, providers) {
  if (!['operator', 'auditor'].includes(identity.role)) throw Object.assign(new Error('forbidden'), { status: 403 });
  const order = await getOrder(identity, orderId);
  if (!order) throw Object.assign(new Error('not_found'), { status: 404 });
  const payment = providers.payment?.reconcile ? await providers.payment.reconcile(order) : null;
  const shipping = providers.shipping?.reconcile ? await providers.shipping.reconcile(order) : null;
  const issues = [];
  if (order.provider_payment_id && (!payment || !['authorized', 'captured'].includes(payment.status))) issues.push('payment_state_unknown');
  if (['partially_fulfilled', 'fulfilled'].includes(order.state) && (!shipping || shipping.status === 'missing')) issues.push('shipping_state_unknown');
  return transaction(async (client) => {
    if (issues.length) await client.query("UPDATE commerce_orders SET state='exception', failure_code='reconciliation_mismatch', version=version+1, updated_at=now() WHERE tenant_id=$1 AND id=$2", [identity.tenantId, orderId]);
    await appendAudit(client, { tenantId: identity.tenantId, actorId: identity.id, orderId, action: 'order.reconciled', details: { issues, paymentStatus: payment?.status || 'unavailable', shippingStatus: shipping?.status || 'unavailable' } });
    return { issues, consistent: issues.length === 0 };
  });
}
