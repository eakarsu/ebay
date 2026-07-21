# Completeness Review: ebay

**Review date:** 2026-07-18

## Assessment basis

Static inspection of project-owned source and configuration only; no dependency installation, build, database migration, external-service call, or runtime launch was performed. The scan considered 27 project files (16 source files), 1 manifest(s), 0 test-like file(s), and 0 CI workflow(s), excluding dependency/generated directories.

## Classification

**Prototype-demo**

This is a prototype/demo for commerce/order operations. Generated gap/demo patterns are present: it contains 16 source files and visible routes/pages in `src/`, `.bolt/`, but those surfaces are not evidence of durable domain execution, verified integrations, or operational completion.

## Why it is not complete

- Mock, demo, sample, fixture, or placeholder behavior remains in executable/product paths.
- No recognizable project-owned automated tests were found for the main workflow.
- No checked-in CI workflow proves builds, tests, migrations, and security checks on every change.
- No environment template documents required configuration and secret boundaries.
- No clear deployment/container configuration demonstrates a reproducible production topology.

## Needed features

1. Implement an idempotent order state machine covering reservation, payment, cancellation, refund, fulfillment, and exception recovery.
2. Connect real inventory, tax, payment, shipping/delivery, and partner-webhook providers behind retry-safe adapters.
3. Add role-scoped customer, operator, and merchant workflows with immutable order and refund audit history.
4. Test duplicate webhooks, partial fulfillment, payment failure, overselling, and reconciliation end to end.
5. Add risk-based unit, integration, and end-to-end tests in CI, including migration and failure-path coverage.

## Risks or launch blockers

- Regression risk is high because no recognizable project-owned automated tests cover the main path.
- No CI evidence prevents broken or insecure changes from reaching a release.

## Evidence inspected

- `README.md`
- `src/components/Filters.tsx:16`
- `src/App.tsx`
- `src/main.tsx`
- `package.json`

## Recommended next action

Stop adding generated pages; prove one commerce/order operations workflow against real services and persistent state, with tests and measurable acceptance criteria.

## Implementation progress (2026-07-19)

All five source-actionable recommendations are now implemented.

1. `server/orders.js` and the checksum-ledgered PostgreSQL migration implement an idempotent, row-locked order state machine across inventory reservation, tax, payment, paid/cancel-pending/cancelled states, partial/full fulfillment, independently approved refunds, exceptions, reconciliation, expired-worker lease recovery, and explicit operator recovery of ambiguous provider operations. Inventory invariants and stale-operation guards prevent overselling and late provider results from reviving terminal orders.
2. `server/providers.js` supplies production-configured inventory, tax, payment, and shipping HTTPS adapters with bearer authentication, per-write idempotency keys, request timeouts, strict response contracts, bounded durable retry, ambiguous-outcome holds, and read-only reconciliation. The API verifies timestamped raw-body HMAC partner webhooks, validates canonical payload hashes, and persists/deduplicates provider event IDs before applying them. Actual third-party credentials, account enablement, carrier/tax policy, and sandbox certification remain deployment-owner launch gates and are documented explicitly rather than simulated.
3. Live database-backed JWT identities enforce tenant-scoped customer, merchant, operator, and auditor roles, immediate deactivation/token-version revocation, customer ownership, operator-only provider recovery, and independent refund approval. Each state-changing action enters a serialized SHA-256 hash chain protected by a PostgreSQL append-only trigger; the audit endpoint verifies the chain before reporting it. The unrelated generated landing page was retired in favor of a live role-aware order/provider/exception console that does not persist bearer tokens.
4. Fourteen project-owned tests now cover canonical provider contracts, invalid responses, migration replay, concurrent overselling, idempotency conflict, complete reserve/tax/pay/ship progression, payment decline and inventory release, duplicate partial-fulfillment webhooks, cancellation, two-person refund approval and duplicate refund events, HTTP tenant/customer isolation, unsigned/signed webhook behavior, reconciliation drift, audit immutability, ambiguous outcomes, and operator-controlled recovery.
5. CI provisions disposable PostgreSQL 17, replays migrations twice, runs server syntax, strict lint/type checks, all unit/integration/HTTP workflow tests, the production UI build, full dependency audit, source secret scanning, and both container targets. Safe explicit migration/start scripts, a production API/worker/web/PostgreSQL topology, environment template, development-only guarded seed, security guidance, and provider/backup/restore/incident runbooks are checked in. Local verification passed 14/14 tests on an isolated fresh PostgreSQL 17 cluster, clean `npm ci`, migration replay, server syntax, lint, strict TypeScript, Vite production build, full and production dependency audits with zero vulnerabilities, source secret scan, shell syntax, Compose rendering, and diff whitespace checks. A Docker daemon was unavailable locally, so image execution remains CI evidence rather than a claimed local result.

## Runtime verification (2026-07-20)

- Verified `start.sh` from a disposable symlinked project fixture using PostgreSQL `55644`, API `6098`, and reserved UI port `6099`; all ports were released afterward.
- Provisioned an environment-supplied administrator in fresh PostgreSQL state, logged in through `/api/auth/login`, and verified the bearer-token session through `/api/auth/me`. Final result: `API_VERIFIED startup_login_session_api`.
- The first attempt exposed symlink-sensitive entry-point detection and was retained as `FAILED no_owned_listener`; the repair uses real-path entry detection. A second successful login-only attempt was also retained before adding the standard authenticated session endpoint. Every attempt is recorded in `_runtime_non_suite_repair_shard3q.tsv`.
- Replayed both checksum-ledgered migrations and passed 14/14 maintained tests against disposable PostgreSQL on port `55644`; server checks, strict type checking, and the production frontend build also passed.
