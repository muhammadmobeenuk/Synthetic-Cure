# Completed slice · P3 Client Portal, Webhooks/Notifications, and Carrier/Accounting Adapters Foundation

Acceptance: Deliver authenticated client portal self-service, operational event webhooks, and standardized carrier/accounting export adapters:
1. Client & stock-owner portal (`client_portal_users`): Scoped client access mapped to specific `customer_id` and/or `stock_owner_id`. Authoritative balances (`GET /api/v1/portal/inventory`), customer order history (`GET /api/v1/portal/orders`), draft customer order placement (`POST /api/v1/portal/orders`), and tracked shipments with delivery notes (`GET /api/v1/portal/shipments`). Invariant: Strict tenant and entity isolation; clients can never view, search, or mutate stock or orders belonging to another customer or stock owner.
2. Operational event webhooks & notifications (`notification_endpoints`, `notification_deliveries`): Asynchronous, durable webhook subscription engine supporting event topics (`order.created`, `order.dispatched`, `order.delivered`, `inbound.received`, `quality_hold.placed`, `recall.initiated`). Generates HMAC-SHA256 signature (`X-Synthetic-Signature`) for payload verification, maintains delivery audit log with response codes and retry status, and supports manual test pings (`POST /api/v1/notifications/test`).
3. Carrier manifest & accounting export adapters (`carrier_manifests`): Carrier booking and shipment manifest generation (`GET /api/v1/adapters/carrier/manifest/:tripId`) with vehicle, pallet, box count, and stop breakdowns in structured JSON and CSV formats. Accounting invoice and ledger export adapter (`GET /api/v1/adapters/accounting/export`) providing verified physical quantities, unit breakdowns, formula-injection neutralization (`=`, `+`, `-`, `@`), and explicit unverified pricing notices.
4. Additive database migration & backup v8: Migration `019_client_portal_notifications_adapters.sql`, backup format `jadesun-v8` in `packages/database/backup.ts` preserving legacy v1–v7 restore compatibility without data loss or duplicate bootstrap entries.
5. User interface: Client Portal view, Webhook settings panel, and Carrier/Accounting export action triggers in `apps/web`.

Contracts: `packages/contracts/portal.ts`, `packages/contracts/notifications.ts`, `packages/contracts/adapters.ts`.
Domain: `packages/domain/portal.ts`, `packages/domain/notifications.ts`, `packages/domain/adapters.ts`.
Database: Migration `019_client_portal_notifications_adapters.sql`, logical backup v8 in `packages/database/backup.ts`.
API: `/api/v1/portal/*`, `/api/v1/notifications/*`, `/api/v1/adapters/*`.
UI: `apps/web/src/PortalView.tsx`, integrated in `apps/web/src/main.tsx`.

Failure/recovery: preserve all domain invariants—server-derived actors and provenance, zero stock changes from OCR, stable box identity, at most one pallet, standalone vs inherited pallet location, verified conversions only, transactional idempotency (`clientOperationId`), 409 on stale versions, append-only audit events, returns held, no stock invented.

Verification:
- P3 Portal, Notifications & Adapters Test Suite (`tests/p3-portal-notifications-adapters.test.ts`): PASSED (6/6 tests, 100% pass rate).
- Full Regression Test Suite (`npm test`): PASSED (145 tests: 143 passed, 0 failed, 2 skipped: 1 native PostgreSQL skipped, 1 tesseract skipped; 39.9s).
- Strict TypeScript Check (`npm run typecheck` / `tsc --noEmit`): PASSED (0 errors).
- Client Application Bundle Build (`npm run build` / `vite build`): PASSED (built in 598ms).
- Native PostgreSQL Concurrency & Restore: BLOCKED pending provision of disposable databases (`TEST_DATABASE_URL` and `TEST_RESTORE_DATABASE_URL`).
- Physical Warehouse Mobile Terminals & Hardware Scanners: UNVERIFIED (hardware not connected). Production readiness is not claimed.

## Next slice · P3 PowerPoint Operations Report (Pending User Specifications)
Awaiting user specification of target audience, report metrics/data scopes, and template requirements before implementing PowerPoint generation.

## Previous slice · P2 Batch/Serial/Expiry Tracing, Quality Holds, Recalls and Scoped Offline Sync

Acceptance: Deliver complete product traceability, quality quarantine holds, recall investigation & execution, and scoped offline sync with bounded retries:
1. Batch, serial & expiry tracing: Serial number tracking (`item_serials`), lot metadata extension (manufacturing date, origin, cold chain limits, quality status), and forward/backward traceability query engine.
2. Quality holds & quarantine (`quality_holds`): Authorized supervisors can place and release quality holds on products, lots, serials, boxes, or locations with explicit reason and severity (`critical`, `major`, `minor`). Invariant: Stock under active quality hold cannot be allocated, picked, loaded, or dispatched. Releasing holds requires supervisor authorization, disposition notes, and records immutable compensating audit events.
3. Recall management & impact analysis (`recalls`): Authoritative recall initiation (`initiateRecall`) atomically places matching on-hand inventory into quarantine hold, performs forward trace across all outbound shipments, trips, drivers, and destinations, records affected customer details, and generates an official recall report (`getRecallReport`) and CSV export with formula injection neutralization.
4. Scoped offline sync engine (`sync_outbox`): Queue operations with stable client operation IDs (`clientOperationId`), expected versions, and explicit dependencies.
5. File-before-command dependency: Operations with photo/document attachments (e.g. damaged box photo, delivery signature) must verify authoritative file storage before the dependent domain mutation can be dispatched.
6. Visible conflict resolution: Stale entity versions return 409 `VERSION_CONFLICT` and transition queue items to visible `conflict` status without silent overwrites or lost user work.
7. Bounded retries: Exponential backoff with maximum attempt limit (5); network failures do not drop queue items or mark unconfirmed operations as confirmed.
8. Server confirmation gate for final dispatch: Final dispatch (`dispatchShipment`, `completeDelivery`) strictly requires authoritative server confirmation; cannot be marked dispatched in local UI without HTTP 200 from server.

Contracts: `packages/contracts/traceability.ts`, `packages/contracts/offline-sync.ts`.
Domain: `packages/domain/traceability.ts`, `packages/domain/offline-sync.ts`, with integration in `packages/domain/services.ts`, `orders.ts`, `picking.ts`, `transport.ts`.
Database: Migration `018_traceability_recalls_offline_sync.sql`, logical backup v7 in `packages/database/backup.ts`.
API: `/api/v1/quality-holds`, `/api/v1/traceability/*`, `/api/v1/recalls/*`, `/api/v1/sync/outbox/*`.
UI: Traceability, Quality Holds & Recalls review view and Offline Sync Status panel in `apps/web`.

Failure/recovery: preserve all domain invariants—server-derived actors and provenance, zero stock changes from OCR, stable box identity, at most one pallet, standalone vs inherited pallet location, verified conversions only, transactional idempotency (`clientOperationId`), 409 on stale versions, append-only audit events, returns held, no stock invented.

Verification:
- P2 Traceability & Offline Sync Test Suite (`tests/p2-traceability-recalls-offline-sync.test.ts`): PASSED (6/6 tests, 100% pass rate).
- Full Regression Test Suite (`npm test`): PASSED (139 tests: 137 passed, 0 failed, 2 skipped: 1 native PostgreSQL skipped, 1 tesseract skipped).
- Strict TypeScript Check (`npm run typecheck` / `tsc --noEmit`): PASSED (0 errors).
- Client Application Bundle Build (`npm run build` / `vite build`): PASSED (built in 464ms).
- Native PostgreSQL Concurrency & Restore: BLOCKED (disposable database URLs `TEST_DATABASE_URL` and `TEST_RESTORE_DATABASE_URL` not configured in environment).
- Physical Warehouse Mobile Terminals & Hardware Scanners: UNVERIFIED (hardware not connected). Production readiness is not claimed.

## Previous slice · P1 daily work, orders and transport


Acceptance: Deliver daily work, orders, transport, and customer documents across 8 core domains:
1. Warehouse tasks and shift handover: Assignee (`assigned_user_id`), priority, due time (`due_at`), claim/reassign with optimistic concurrency control (`expectedVersion`), blocked reason (`blocked_reason`), status tracking, and shift handover lists (`shift_handovers`). Invariant: Completing a task does not itself mutate stock; the actual domain command must succeed.
2. Picking exceptions: Explicit source, product, lot, and quantity verification, identified totes (`picking_totes`), shortage tracking, and supervisor-authorized substitution (`is_substitution`, `substituted_product_id`, `substitution_reason`, `authorized_by`). Invariant: Preserve requested and substituted product and reasons; no silent substitutions.
3. Packing and changing checked work: Package split and repack exception handling, quantity conservation (total quantity, catch weight, and package count conserved), and cascading manifest/check invalidation on every relevant change (`invalidate()` invalidates containing pallet `checked_revision` and preparation order `checked`/`stage`, resetting shipments to `needs_recheck`).
4. Pallet group to shipment review: Complete end-to-end loading workflow (`loadPalletGroupWorkflow`), stopping incorrect shipments while allowing approved mixed customers and multiple pallets per trip/destination. Invariants: Grouping never means physical nesting; review itself is not load approval.
5. Stop-specific delivery and custody: Stop-specific delivery, partial delivery, failed delivery (`failStopDelivery`, returning boxes to hold with issues), delivery to intermediary vs final recipient (`recipient_type`: `'final_recipient'` | `'intermediary'`, signature/name), reverse collection at stops (`collectStopReturn`), and driver reassignment history (`driver_reassignments`). Invariant: Loading is not delivery; custody remains with driver until verified stop handover.
6. Staff-only order sheet and customer documents: Staff print sheet preserved. Separately gate customer-facing delivery notes, tax invoices, and recipient pallet labels: require confirmed commercial/tax terms and current pricing; reject unverified historical 2027 prices/marks with 422 `COMMERCIAL_REQUIREMENTS_UNCONFIRMED`. Output physical-only delivery note marked "PHYSICAL QUANTITIES ONLY · COMMERCIAL PRICING UNCONFIRMED".
7. Cancellation, backorder and reconciliation: Reconciled order cancellation (`cancelOrderWithReconciliation`), allocation release, packed box unpacking/invalidation, shortage/backorder visibility (`order_backorders`), compensating event `order.reconciled_cancellation`, supervisor authorization. Invariant: Never cancel history or silently leave checked loads valid.
8. Configurable preparation schedules: Multi-company scheduling: prove another company can choose different days (e.g. `[1, 4]` Mon/Thu vs `[3]` Wed); recurring templates create/suggest empty batches only (`suggestPreparationBatches`, `createScheduledEmptyBatch`). Invariant: Wednesday remains JadeSun preparation, never implicit delivery or automatic customer orders.

Failure/recovery: preserve all domain invariants—server-derived actors and provenance, zero stock changes from OCR, stable box identity, at most one pallet, standalone vs inherited pallet location, verified conversions only, transactional idempotency (`clientOperationId`), 409 on stale versions, append-only audit events, returns held, no stock invented.

Verification: P1 daily work test suite (`tests/p1-daily-work-orders-transport.test.ts`, 8/8 passed covering all 8 user requirements); full test suite (`npm test`, 133 tests: 131 passed, 0 failed, 2 skipped); TypeScript check (`tsc --noEmit`, zero errors); production build (`vite build` in 550ms); all verify checks clean (`npm run verify`). Native PostgreSQL independent-client concurrency, native migrations, and native restore remain BLOCKED pending provision of two disposable database URLs. Physical devices remain unverified.

## Previous slice · P1 inventory and inbound foundation

Acceptance: Deliver unified quantity/container inventory, stock ownership, unit conversions & variable weight, multi-line purchase orders/expected inbound, delivery discrepancies, supplier returns, putaway tasks, replenishment, inter-warehouse transfers, multi-entity opening inventory & imports, guided warehouse onboarding & configuration:
1. Unified quantity/container inventory: Coherent ledger (`inventory_ledger`) & balances (`inventory_balances`) for loose/measured bulk goods without artificial boxes; tracks physical `on_hand`, `reserved`, `available`, `picked`, `in_transit`, `held`, and `dispatched`. Invariant: `available = on_hand - reserved - picked - held`; reservations do not create stock.
2. Stock ownership: Explicit stock owners (`stock_owners`) distinct from company, ordering customer, and receiver; owner-specific balances and authorizations before 3PL storage claims.
3. Units, pack definitions & variable weight: Product-specific verified conversions (`product_unit_conversions`) with transaction snapshots; partial cases and independent measured catch weight (`catch_weight`) and package count (`package_count`). Invariant: Unknown conversion is not zero and must not create item or weight totals.
4. Multi-line purchase orders / expected inbound: Multi-line POs (`purchase_orders`, `purchase_order_lines`) with supplier reference, expected dates/quantities, partial arrivals, remaining balances, and additive compatibility preserving single-product expected receipts.
5. Unexpected, over, short and damaged delivery: Explicit discrepancy records (`inbound_discrepancies`) and authorized review/approval (`accept_hold`, `reject_return`, `adjust_po`) without silently altering POs. Records evidence, counts, and disposition.
6. Supplier return: Separate from customer returns: identify supplier/receipt, held goods, quantity, authorization, outbound custody, and reconciliation without releasing held goods to available stock implicitly.
7. Putaway tasks: `warehouse_tasks` with scan/ID confirmation, source and destination, assignment, physical placement, and verified restriction/capacity compatibility.
8. Replenishment: Configurable min/target per picking location (`location_replenishment_policies`), reserve-to-pick task generation, duplicate-open-task prevention, hold/reservation checks, and confirmed movement.
9. Inter-warehouse transfer: Explicit transfer orders (`transfer_orders`, `transfer_lines`); dispatch from source creates `in_transit` inventory; destination receipt removes transit and creates destination stock; support partial/damaged receipts. Never show one quantity available in both warehouses simultaneously.
10. Opening inventory and imports: Multi-entity CSV import pipelines (`csv_imports`, `csv_import_errors`) for customers, suppliers, locations, orders, expected receipts, and opening stock with dry-run/preview, error reports, and separate cut-over date reconciliation for opening stock.
11. Onboarding and configuration: Guided, resumable warehouse setup (`warehouse_onboarding`, `policy_snapshots`) covering goods profiles, staff, schedules, label preferences, imports, opening balances, readiness review, and policy snapshots.

Failure/recovery: preserve all domain invariants—server-derived actors and provenance, zero stock changes from OCR, stable box identity, at most one pallet, standalone vs inherited pallet location, verified conversions only, transactional idempotency (`clientOperationId`), 409 on stale versions, append-only audit events, returns held, no stock invented.

Verification: P1 test suite (`tests/p1-inventory-inbound.test.ts`, 11/11 passed covering all 11 user requirements); full test suite (`npm test`, 125 tests: 123 passed, 0 failed, 2 skipped); TypeScript check (`tsc --noEmit`, zero errors); production build (`vite build` in 511ms); all verify checks clean (`npm run verify`). Native PostgreSQL independent-client concurrency, native migrations, and native restore remain BLOCKED pending provision of two disposable database URLs. Physical devices remain unverified.

## Previous slice · P0 trust, data integrity & release gates remediation (PLATFORM-004)

Acceptance: resolve core P0 platform gaps before real-stock pilot:
1. Worker reliability: Eliminate long-running database transactions (up to 30s) during OCR and external tasks. Implement leased job claims (`FOR UPDATE SKIP LOCKED`), out-of-transaction bounded processing with streamed batch inventory exports (500 records/page via deterministic `(code, id)` pagination), crash recovery reclaiming expired leases, retry/dead-letter tracking, and transactional finalize with permission re-check.
2. Scoped pagination & payload correctness: Eliminate unpaginated/overloaded workspace queries. Implement indexed server-side search (`GET /api/v1/search`) with deterministic base64url cursor pagination, cross-query cursor validation, complete aggregate definitions, and strict query bounds for drivers. Isolate driver role from warehouse internal entities.
3. Staff provisioning & revocation lifecycle: Add `staffProvision` contract, `provisionStaff` domain service, `POST /api/v1/access/staff` endpoint, and UI controls in `AccessControl.tsx`. Support direct creation of staff identities with optional credentials and warehouse grants with immutable audit events. Enforce immediate revocation on sessions (401 UNAUTHENTICATED) and commands (403 UNAUTHORIZED) with last-administrator protection.
4. Authoritative deployment readiness: Implement `/api/ready` dual health probe verifying database connectivity (`SELECT 1`) and private file storage read/write accessibility (returning 503 if either fails).
5. Crash, network & uncertain recovery: Verify screen-by-screen that unconfirmed responses retain original `clientOperationId` and payload for idempotent replay, 409 conflicts preserve user work, session expiration triggers `preservePendingWork()` before re-authentication, and success appears only upon server confirmation.

Failure/recovery: preserve all domain invariants—server-derived actors and provenance, zero stock changes from OCR, stable box identity, at most one pallet, standalone vs inherited pallet location, verified conversions only, transactional idempotency (`clientOperationId`), 409 on stale versions, append-only audit events.

Verification: Full test suite (`npm test`, 114 tests: 112 passed, 0 failed, 2 skipped); TypeScript check (`tsc --noEmit`, zero errors); production build (`vite build` in 494ms); all verify checks clean (`npm run verify`). Native PostgreSQL independent-client concurrency, native migrations, and native restore remain BLOCKED pending provision of two disposable database URLs. Physical devices remain unverified.

## Previous slice · warehouse floor operations, smart inputs & cold-chain safety

Acceptance: warehouse operators and delivery drivers experience modern, intelligent input fields with touch-friendly 48px hit areas. Replaces flat select dropdowns with searchable comboboxes supporting SKU, English, and Chinese names. Replaces raw numeric inputs with smart quantity steppers with unit affixes and quick-action increments. Scopes order destinations to selected customer branches and visualizes Available-to-Promise (ATP) unallocated stock. Implements FEFO (First-Expired, First-Out) picking and allocation priority. Validates cold-chain putaway environmental compatibility when moving or receiving chilled/frozen goods into ambient storage. Provides electronic Proof of Delivery (e-POD) canvas signature pad and delivery status tags for driver handover. Validates vehicle deck capacity (pallets and box totals) during delivery trip planning.

Failure/recovery: preserve all domain invariants—optimistic locking, monotonic versions, server-derived actors, idempotent operation IDs, immutable audit history. Environmental compatibility warnings alert operators without blocking emergency operations. Stale versions return 409 and preserve form drafts. Incomplete signatures or missing quantities prevent submission before transaction.

Verification: unit tests covering environmental compatibility and GS1 parsing (tests/smart-inputs.test.ts); regression suite (tests/api-response.test.ts, tests/csv.test.ts, tests/signout.test.ts); TypeScript check (tsc --noEmit); production bundle build (vite build).

## Previous slice · cancel outstanding expected inbound

Acceptance: supervisor/administrator can cancel the unreceived portion of an expected receipt with a reason and expected version; existing boxes, stock, held quantities and receipt history remain untouched. Show canceled quantity separately and zero outstanding to receive. Cancellation is an immutable business event and is safe to retry with the same operation ID. Receiving after cancellation must fail.

Failure/recovery: reject stale version, unauthorized actors, foreign warehouse, already canceled and fully received expectations. Lock the expectation so cancellation cannot race a receipt. A lost response retains the pending operation; a structured rejection allows review and correction. Do not infer a supplier return or delete prior records. Existing fonts and navigation stay unchanged.

Verification: partial receipt followed by cancellation, exact replay, 409 stale/second cancellation, receiving after cancellation, permission and scope, immutable event/uniqueness, backup/restore; separately note native PostgreSQL and browser status.

## Previous slice · expected inbound, one product per expectation

Acceptance: authorized staff create a supplier and a dated expected receipt for one product in its confirmed base unit, then receive one or more physical boxes against it. Each receipt records verified quantity, condition and location; received quantities cannot exceed expectation; duplicate command replays return the same result; uncertain or held goods remain unavailable under existing rules. Show expected, received, held, pending confirmation and outstanding separately. No stock is created by planning. Audit and backup the new records. UI retains existing fonts/navigation.

Failure/recovery: reject stale version, foreign supplier/product/location, unsupported units, duplicate supplier code, over-receipt or invalid quantities transactionally; preserve pending form data on failure. No invented supplier identity, arrival, stock, conversion or prices. Unexpected delivery and over-receipt approvals remain separate future workflows, as do multi-line purchase orders and supplier returns.

Verify migration, company/warehouse scope, partial/held receipt, replay, over-receipt, stale writes and backup/restore; browser and native PostgreSQL separately.

## Previous slice · uncertain server responses

Acceptance: malformed, empty or non-JSON API responses never appear as confirmed success. Return a clear recoverable error that does not classify an uncertain mutation as a definitive client rejection; retain existing operation IDs and device drafts for safe replay. Preserve structured server errors and successful JSON responses. Do not display untrusted HTML. Keep current interface, fonts and navigation.

Failure/recovery: a server can commit before its reply is lost or replaced by an intermediary. Tell staff the outcome is unconfirmed and direct them to retry the exact operation or check its status. A bad response to a read also reports a failure. A failed device save must not be described as saved. Automatic offline sync remains out of scope.

Verify success, structured errors, 4xx/5xx HTML, malformed 2xx, empty response and network failure; run full regression/typecheck/build. Native PostgreSQL and browser verification separately reported.

## Previous slice · pallet-group review pagination

Acceptance: dispatch staff can page through every box in a group using a bounded, deterministic cursor; distinguish page end from an empty group; explicitly warn the review is live and must be restarted after changes. Invalid or stale-group cursors produce a recoverable error. Every request checks active company, warehouse and dispatch access. A failed page retains the option to retry or restart. Keep navigation, fonts, planning-only semantics, and authoritative dispatch checks unchanged.

Failure/recovery: box moves and shipment changes can occur between page requests; pages are not a frozen manifest and cannot be used as a load approval. If membership changes, reject the stale cursor and restart. Do not expose another company's cached page after switching context.

Verify: more than 200 boxes, no repeated or missing boxes in an unchanged fixture, malformed and stale cursors, authorization and regression build/tests. Native PostgreSQL, visual-device and live-preview status must be reported separately.

## Previous slice · pallet-group shipment reconciliation

Acceptance: authorized dispatch staff can review the current shipment/trip and loaded state of each physical box on grouped pallets. Show unassigned, matching trip, different trip and multiple active assignments explicitly; deduplicate multiple product lines per box/shipment. The view is read-only, bounded, warehouse-scoped, and clearly states it does not approve a load or dispatch. Mixed customers and destinations are allowed. Grouping is not physical nesting.

Failure/recovery: show retry on request failure and clearly mark a truncated result; do not infer an empty manifest when a request fails. Existing load/dispatch checks remain authoritative. No new block or stock mutation from planning information.

Relevant: packages/domain/pallet-groups.ts, apps/api/app.ts, apps/web/src/PalletGroups.tsx, tests/workflows.test.ts, docs/CONTRACTS.md. Verify isolated scope, line deduplication, changed membership and unassigned/other trip cases; run regression checks.

## Previous slice · protect work on sign-out

Acceptance: capture open registered forms before checking unsynced drafts; warn before discarding; abort sign-out when device capture or draft lookup fails; never clear device drafts when server sign-out fails. Preserve existing fonts and navigation. A sign-out clears confirmed local drafts only after server confirmation.

Failure/recovery: if device storage fails, keep the page open and show a retry message. If the user cancels, do not sign out or clear drafts. If the server cannot confirm sign-out, retain drafts and report the error. If local cleanup fails after sign-out, report that device data may remain and do not claim removal.

Relevant files: apps/web/src/work-preservation.ts, apps/web/src/main.tsx, tests/signout.test.ts. Verify the decision sequence and existing regression suite; record browser and native database limits.

## Previous slice · order entry and scrollbars

Keep fonts/navigation. Improve staff order entry with searchable bilingual SKU choices, accurate unit labels, clear positive quantity validation and destination recheck on customer changes without assuming relationships. Preserve drafts, retry/idempotency and server validation. Hide scrollbar chrome but retain scrolling and keyboard focus. Do not infer pack conversions or stock. Verify build, browser form/filter/validation, and existing tests where applicable; record limits.
