CREATE TABLE IF NOT EXISTS commerce_tenants (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commerce_identities (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES commerce_tenants(id),
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('customer', 'merchant', 'operator', 'auditor')),
  active boolean NOT NULL DEFAULT true,
  token_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS commerce_catalog_items (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES commerce_tenants(id),
  merchant_id uuid NOT NULL REFERENCES commerce_identities(id),
  sku text NOT NULL,
  title text NOT NULL,
  unit_price_cents integer NOT NULL CHECK (unit_price_cents > 0),
  inventory_on_hand integer NOT NULL CHECK (inventory_on_hand >= 0),
  inventory_reserved integer NOT NULL DEFAULT 0 CHECK (inventory_reserved >= 0),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku),
  CHECK (inventory_reserved <= inventory_on_hand)
);

CREATE TABLE IF NOT EXISTS commerce_orders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES commerce_tenants(id),
  customer_id uuid NOT NULL REFERENCES commerce_identities(id),
  idempotency_key text NOT NULL,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN (
    'reservation_pending', 'awaiting_payment', 'paid', 'partially_fulfilled',
    'fulfilled', 'cancel_pending', 'cancelled', 'refund_pending', 'refunded', 'exception'
  )),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  shipping_cents integer NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  shipping_address jsonb NOT NULL,
  provider_payment_id text,
  failure_code text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, customer_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS commerce_order_items (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES commerce_tenants(id),
  order_id uuid NOT NULL REFERENCES commerce_orders(id),
  catalog_item_id uuid NOT NULL REFERENCES commerce_catalog_items(id),
  sku text NOT NULL,
  title text NOT NULL,
  unit_price_cents integer NOT NULL CHECK (unit_price_cents > 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  reserved_quantity integer NOT NULL CHECK (reserved_quantity >= 0),
  fulfilled_quantity integer NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0),
  refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  UNIQUE (order_id, catalog_item_id),
  CHECK (fulfilled_quantity <= quantity),
  CHECK (reserved_quantity <= quantity)
);

CREATE TABLE IF NOT EXISTS commerce_provider_operations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES commerce_tenants(id),
  order_id uuid NOT NULL REFERENCES commerce_orders(id),
  provider text NOT NULL CHECK (provider IN ('inventory', 'tax', 'payment', 'shipping')),
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'processing', 'retry', 'succeeded', 'pending_unknown', 'dead_letter')),
  request jsonb NOT NULL,
  response jsonb,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, idempotency_key)
);

CREATE TABLE IF NOT EXISTS commerce_provider_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES commerce_tenants(id),
  provider text NOT NULL CHECK (provider IN ('inventory', 'tax', 'payment', 'shipping')),
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz,
  UNIQUE (tenant_id, provider, event_id)
);

CREATE TABLE IF NOT EXISTS commerce_fulfillments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES commerce_tenants(id),
  order_id uuid NOT NULL REFERENCES commerce_orders(id),
  provider_event_id uuid NOT NULL REFERENCES commerce_provider_events(id),
  tracking_number text,
  items jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_event_id)
);

CREATE TABLE IF NOT EXISTS commerce_refunds (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES commerce_tenants(id),
  order_id uuid NOT NULL REFERENCES commerce_orders(id),
  requested_by uuid NOT NULL REFERENCES commerce_identities(id),
  approved_by uuid REFERENCES commerce_identities(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL,
  state text NOT NULL CHECK (state IN ('requested', 'approved', 'processing', 'succeeded', 'failed')),
  provider_refund_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commerce_audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES commerce_tenants(id),
  sequence bigint NOT NULL,
  actor_id uuid NOT NULL REFERENCES commerce_identities(id),
  order_id uuid REFERENCES commerce_orders(id),
  action text NOT NULL,
  details jsonb NOT NULL,
  previous_hash text NOT NULL CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
  event_hash text NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (tenant_id, sequence),
  UNIQUE (tenant_id, event_hash)
);

CREATE OR REPLACE FUNCTION commerce_reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'commerce audit events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS commerce_audit_immutable ON commerce_audit_events;
CREATE TRIGGER commerce_audit_immutable
BEFORE UPDATE OR DELETE ON commerce_audit_events
FOR EACH ROW EXECUTE FUNCTION commerce_reject_audit_mutation();

CREATE INDEX IF NOT EXISTS commerce_orders_tenant_customer_idx ON commerce_orders(tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commerce_provider_operations_due_idx ON commerce_provider_operations(state, next_attempt_at);
CREATE INDEX IF NOT EXISTS commerce_audit_tenant_sequence_idx ON commerce_audit_events(tenant_id, sequence);
