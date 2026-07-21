# Operations runbook

## Release sequence

1. Back up PostgreSQL and verify the backup can be read.
2. Build and scan the immutable image.
3. Run `npm run db:migrate` once as a restricted migration identity. Re-running is safe; altered historical migration checksums are rejected.
4. Start API instances. Startup checks for the migration ledger but never creates or changes schema.
5. Start workers only after all inventory, tax, payment, and shipping credentials are present.
6. Verify `/health`, a read-only catalog query, provider sandbox reconciliation, and the audit-chain verification endpoint.

For the included topology, copy `.env.example`, fill secrets, then run `docker compose run --rm migrate` followed by `docker compose up -d db api worker web`. The `migrate` service is profile-gated and is never an API startup dependency.

## Provider contract

Each provider receives `POST /v1/{domain}/{operation}` with a bearer credential and `Idempotency-Key`. Mutating responses must match the schemas in `server/providers.js`. The same key must return the original provider result. Timeouts are classified as ambiguous and are not automatically replayed.

Providers expose `POST /v1/reconcile` for read-only state checks. Partner events call `POST /api/provider-webhooks/{provider}` with:

- `X-Commerce-Timestamp`: Unix epoch milliseconds, within five minutes.
- `X-Commerce-Signature`: lowercase hex HMAC-SHA256 of `<timestamp>.<raw request body>`.
- A body containing `tenantId`, stable `eventId`, `eventType`, and `payload.orderId`.

Rotate provider tokens and the webhook secret through the deployment secret store. Accept the old webhook secret during a planned overlap at the ingress layer; this application intentionally accepts only one active application secret.

## Alerts and recovery

Alert on operations in `pending_unknown`, `dead_letter`, or expired `processing`; order state `exception`; audit verification failure; webhook signature failures; increasing retry counts; and reserved inventory with no active order progression.

For `pending_unknown`, inspect the provider by the exact idempotency key. An operator may use `POST /api/operations/:id/retry` only after confirming the provider honors that key. This action is role checked and appended to the audit chain. Use order reconciliation for payment/shipping drift; do not edit state tables manually.

Audit rows reject update/delete in PostgreSQL. Restrict application ownership so it cannot disable the trigger or alter migrations. Stream database audit logs to separately administered immutable storage for regulatory retention.

## Backup and restore

- Take encrypted scheduled PostgreSQL backups and point-in-time WAL archives.
- Restore into an isolated environment at least quarterly.
- Apply the same application image and run `npm run db:migrate`.
- Run the integration suite, query inventory invariants, and call `/api/audit` as an auditor to verify every tenant chain.
- Never point integration tests or development seed commands at a shared or production database.

## SLO suggestions

Track API availability, order creation latency, queue age, provider completion latency, webhook lag, reconciliation mismatch rate, and exception recovery time. Define provider-specific retry and incident budgets before production traffic.
