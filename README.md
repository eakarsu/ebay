# Governed Commerce Orders

This project is a persistent, tenant-scoped order control plane. It reserves inventory under row locks, records every external provider mutation in a durable idempotent queue, consumes signed partner webhooks exactly once, and preserves a hash-linked append-only audit history.

## What is implemented

- An explicit order state machine for reservation, tax, payment, cancellation, partial/full fulfillment, refund, exception, and operator recovery.
- PostgreSQL inventory constraints and row locks that prevent concurrent overselling.
- HTTPS inventory, tax, payment, and shipping adapters with timeouts, response schemas, bounded retry, durable leases, idempotency keys, ambiguous-outcome holds, and reconciliation reads.
- Live database-backed JWT identity checks for customer, merchant, operator, and auditor roles. Deactivating an identity or increasing its `token_version` revokes existing access immediately.
- Raw-body HMAC verification, timestamp replay windows, event deduplication, strict tenant scoping, and immutable audit evidence.
- Independent operator approval for refunds and an explicit, audited recovery action for uncertain provider operations.
- A React operations console, safe migration/startup controls, disposable-database tests, CI, and production container targets.

## Local run

Requirements: Node.js 20.19+ and PostgreSQL 17.

```bash
cp .env.example .env
npm ci
npm run db:migrate
ALLOW_DEVELOPMENT_SEED=true npm run db:seed:development
```

The seed command prints short-lived role tokens. It refuses to run in production and must be explicitly enabled. In separate shells, start the API and UI:

```bash
npm run dev:api
npm run dev
```

Open `http://127.0.0.1:5173`, paste one printed token, and connect. The production worker intentionally refuses to start until all four provider URL/token pairs exist.

Database migrations are never run by API or worker startup. Apply them as a reviewed release step with `npm run db:migrate`; the migration runner uses a checksum ledger and advisory lock.

## Validation

```bash
npm run check:server
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level=low
```

Integration tests require a disposable `DATABASE_URL`; they truncate only their dedicated database. See [OPERATIONS.md](OPERATIONS.md) for deployment, provider contracts, backup/restore, and incident recovery.

## External boundaries

This repository provides production-capable adapters and webhook contracts, but it does not contain third-party credentials or certify a specific inventory, tax, payment, or carrier account. Before launch, configure and validate each chosen provider in its sandbox, then run contract tests with the exact account features, webhook signing secret, tax jurisdictions, capture policy, and carrier service levels you will use.
