import { z } from 'zod';

const schemas = {
  'inventory.reserve': z.discriminatedUnion('status', [
    z.object({ status: z.literal('reserved'), reservationId: z.string().min(1) }),
    z.object({ status: z.literal('unavailable') }),
  ]),
  'inventory.release': z.object({ status: z.literal('released') }),
  'tax.quote': z.object({ status: z.literal('quoted'), taxCents: z.number().int().nonnegative(), shippingCents: z.number().int().nonnegative() }),
  'payment.authorize': z.discriminatedUnion('status', [
    z.object({ status: z.literal('authorized'), paymentId: z.string().min(1) }),
    z.object({ status: z.literal('declined'), declineCode: z.string().min(1) }),
  ]),
  'payment.void': z.object({ status: z.literal('voided') }),
  'payment.refund': z.discriminatedUnion('status', [
    z.object({ status: z.literal('accepted'), refundId: z.string().min(1) }),
    z.object({ status: z.literal('declined') }),
  ]),
  'shipping.create': z.object({ status: z.literal('accepted'), shipmentId: z.string() }),
};

export class ProviderFailure extends Error {
  constructor(code, retryable, ambiguous = false) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.ambiguous = ambiguous;
  }
}

export function createHttpProvider({ baseUrl, token, timeoutMs = 5_000 }) {
  const target = new URL(baseUrl);
  if (process.env.NODE_ENV === 'production' && target.protocol !== 'https:') throw new Error('Provider URLs must use HTTPS');
  if (!['https:', 'http:'].includes(target.protocol)) throw new Error('Unsupported provider protocol');
  return {
    async execute(operation, payload, idempotencyKey) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(new URL(`/v1/${operation.replace('.', '/')}`, target), {
          method: 'POST', signal: controller.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey },
          body: JSON.stringify(payload),
        });
      } catch {
        throw new ProviderFailure('provider_network_unknown', true, true);
      } finally {
        clearTimeout(timeout);
      }
      if (response.status === 429 || response.status >= 500) throw new ProviderFailure(`provider_${response.status}`, true);
      if (!response.ok) throw new ProviderFailure(`provider_${response.status}`, false);
      const schema = schemas[operation];
      if (!schema) throw new ProviderFailure('unsupported_operation', false);
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) throw new ProviderFailure('invalid_provider_response', false);
      return parsed.data;
    },
    async reconcile(order) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(new URL('/v1/reconcile', target), {
          method: 'POST', signal: controller.signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ orderId: order.id, paymentId: order.provider_payment_id || null }),
        });
        if (!response.ok) throw new ProviderFailure(`provider_reconcile_${response.status}`, response.status === 429 || response.status >= 500);
        const parsed = z.object({ status: z.string().min(1).max(80) }).passthrough().safeParse(await response.json());
        if (!parsed.success) throw new ProviderFailure('invalid_reconciliation_response', false);
        return parsed.data;
      } catch (error) {
        if (error instanceof ProviderFailure) throw error;
        throw new ProviderFailure('provider_reconciliation_unavailable', true);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function validateProviderResult(operation, result) {
  const schema = schemas[operation];
  if (!schema) throw new ProviderFailure('unsupported_operation', false);
  const parsed = schema.safeParse(result);
  if (!parsed.success) throw new ProviderFailure('invalid_provider_response', false);
  return parsed.data;
}
