import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../audit.js';
import { ProviderFailure, validateProviderResult } from '../providers.js';

describe('provider contracts and canonical evidence', () => {
  it('canonicalizes nested payloads independent of object key order', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: [3, 4] } }))
      .toBe(canonicalJson({ a: { x: [3, 4], y: 2 }, z: 1 }));
  });

  it('rejects malformed provider results before state transitions', () => {
    expect(validateProviderResult('tax.quote', { status: 'quoted', taxCents: 50, shippingCents: 100 })).toMatchObject({ taxCents: 50 });
    expect(() => validateProviderResult('payment.authorize', { status: 'authorized' })).toThrow(ProviderFailure);
    expect(() => validateProviderResult('shipping.create', { status: 'accepted', shipmentId: 7 })).toThrow(/invalid_provider_response/);
  });
});
