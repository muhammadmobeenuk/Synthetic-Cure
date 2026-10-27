# Operational readiness · PLATFORM-001

The candidate is not production-ready. The audit matrix is evidence/PLATFORM-GAP-MATRIX.md. Test logs report actual checks rather than a completeness score.

| Gate | Current result | Required next evidence |
|---|---|---|
| Existing workflow regression/typecheck/build | PASSED | Re-run after consequential changes |
| Company-reference constraints / exports | PASSED on PGlite/HTTP | Native FK/isolation checks |
| Populated migration, ambiguous rollback | PASSED on PGlite | Native migration rehearsal/lock review |
| Logical DB plus private-file restore | PASSED on PGlite | Native PostgreSQL restore and file retrieval |
| Native two-client races | BLOCKED | Two disposable empty PostgreSQL databases |
| Browser photo | See evidence/PLATFORM-001.md | Representative physical phone/camera |
| Phone/tablet journeys | See evidence/PLATFORM-001.md | Physical-device testing and broader journeys |
| Clean source archive setup/build | See evidence/PLATFORM-001.md | Re-run final artifact if inputs change |
| Staff lifecycle, membership and warehouse access | PASSED on PGlite/HTTP | Native authorization/concurrency tests |
| Full onboarding/import/opening reconciliation | PASSED on PGlite/HTTP | Native multi-entity import rehearsal |
| Inventory without containers, serial/weight ledger | PASSED on PGlite/HTTP | Native ledger concurrency and high-volume checks |
| Automatic offline sync, OCR | NOT RUN / unimplemented | Real adapters, visible recovery states |
| Real operational policies and specialist rules | Unconfirmed | Warehouse approval and verified source inputs |

Native testing: explicitly supply TEST_DATABASE_URL and a different TEST_RESTORE_DATABASE_URL, both empty disposable PostgreSQL databases, then `npm run test:postgres`. The runner refuses missing or matching targets, and tests refuse populated source/restore schemas. Allocation/move races use independent pools. A separate check proves distinct backend process IDs. The full domain/file restore exercise uses the native restore database when native testing is enabled; it does not silently use PGlite as proof.

Production release also needs approved role limits, stock-owner/multi-warehouse isolation, verified handling rules, consistent recovery rehearsal, HTTPS/storage monitoring, job failure support, data export/offboarding, retention and measured list/search performance. Do not infer capacities, valuations or regulatory compliance.

## PLATFORM-002 update
Company memberships and operational warehouse isolation are implemented/tested on PGlite/HTTP. Current source has 71 checks, 70 passed and one native-only skipped. Session/context switching, scoped files/exports/workers, revocation replay protection, competing administrator changes and v2/v3 restore are covered. Browser creation/context/grant and draft-isolation/recovery are verified as described in evidence/PLATFORM-002.md. Staff identity provisioning, native authorization/concurrency/restore, operational policy approval and physical-device gates are still open. This supersedes the earlier "membership/warehouse access incomplete" row only for these bounded capabilities.

## PLATFORM-003 update
Product CSV import only is implemented: mapping, bounded parsing, private persisted previews, create-only validation, atomic/idempotent commit, safe CSV reports and reload recovery. Current suite: 84 tests, 83 passed, 0 failed, one native-only skipped. TypeScript/build passed. New restore tests cover v4 originals/links and legacy v3 without imports; legacy v2 test still uses genuine pre-membership schema. Native PostgreSQL remains blocked. Browser file chooser timed out after 10 seconds; pasted-CSV journey and error download succeeded, so file-picker upload is not marked passed. Other import types, opening stock, specialist policies and production gates remain incomplete. Evidence PLATFORM-003.md supersedes earlier product-import missing claims only for this bounded flow.

## PLATFORM-004 update
Addresses core P0 trust, data integrity, and release gate gaps:
- **Worker reliability:** Eliminated long-running transactions (up to 30s) during OCR and file processing. Implemented 3-phase worker execution: (1) atomic short-transaction leased claim (`FOR UPDATE SKIP LOCKED`, 60s lease duration), (2) bounded out-of-transaction execution with streaming inventory export (batches of 500 records using deterministic `(code, id)` pagination), and (3) short-transaction finalization with explicit actor and warehouse grant re-authorization. Added crash recovery for expired leases and dead-letter visibility after 3 failed attempts.
- **Scoped search and pagination correctness:** Added database migration `015_search_and_pagination.sql` with search indexes on operational tables. Implemented `GET /api/v1/search` with independently scoped server-side text matching (`ILIKE`), deterministic base64url cursor pagination, cross-entity cursor validation (returning 422 `CURSOR`), and complete warehouse aggregates (totals are never computed from a partial page). Driver role queries are isolated to assigned trips/shipments (403 `FORBIDDEN` on warehouse internal resources). Bounded driver queries in `/api/v1/workspace` (`stops` <= 200, `shipments` <= 200, `shipmentLines` <= 500) and added full warehouse aggregates to `counts`.
- **Staff provisioning & revocation lifecycle:** Added `staffProvision` contract, `provisionStaff` domain service, `POST /api/v1/access/staff` API endpoint, and UI controls in `AccessControl.tsx`. Allows company administrators to provision staff identities with optional credentials and warehouse grants with immutable audit events. Revocation is immediately enforced in session authentication (401 `UNAUTHENTICATED`) and command transactions (403 `UNAUTHORIZED`). Last administrator demotion protection is verified (`LAST_ADMINISTRATOR` 422).
- **Deployment health & readiness probe:** Implemented `/api/ready` dual health probe verifying database connectivity (`SELECT 1`) and private file storage read/write accessibility (returning 503 `unready` if database or storage volume fails).
- **Crash & network recovery verification:** Audited screens across `Receiving`, `Inbound`, `CustomerOrderForm`, `PalletGroups`, `ProductImport`, `CompanySetup`, and `AccessControl`. Verified that unconfirmed responses retain original `clientOperationId` and payload for idempotent replay, 409 conflicts preserve user work, session expiration triggers `preservePendingWork()` before re-authentication, and success indicators appear only after authoritative server confirmation.

Verification: Full test suite passed (114 tests: 112 passed, 0 failed, 2 skipped); strict TypeScript check passed (`tsc --noEmit`, 0 errors); production build passed (`vite build`).
Limits: Native PostgreSQL independent-client concurrency, native migrations, and native restore remain BLOCKED pending provision of two disposable database URLs (`TEST_DATABASE_URL` and `TEST_RESTORE_DATABASE_URL`). Physical mobile devices, physical cameras, and Bluetooth ring scanners remain unverified. Production readiness is not claimed.

## P1 inventory and inbound foundation update
Implements and verifies all 11 core P1 functional areas:
1. **Unified quantity/container inventory:** Added coherent ledger (`inventory_ledger`) and balance tracking (`inventory_balances`) for loose and measured bulk goods without artificial boxes. Formally defines and tracks physical `on_hand`, `reserved`, `available`, `picked`, `in_transit`, `held`, and `dispatched`. Verified invariant: `available = on_hand - reserved - picked - held`; reservations do not create stock.
2. **Stock ownership:** Added `stock_owners` table with endpoints (`/api/v1/stock-owners` and `/api/v1/inventory/owners`). Distinct stock ownership is enforced with owner-specific balances and authorizations before third-party storage claims.
3. **Units, pack definitions and variable weight:** Added `product_unit_conversions` with transaction snapshots and verified conversion lookup (`convertProductQuantity`). Contents records track independent measured `catch_weight` and `package_count`. Unknown conversions return null and do not create synthetic totals.
4. **Multi-line purchase orders/expected inbound:** Added `purchase_orders` and `purchase_order_lines` with supplier references, expected dates, quantities, line status, partial arrivals, and remaining balances. Additive migration 016 preserves single-product expected receipts.
5. **Unexpected, over, short and damaged delivery:** Added `inbound_discrepancies` with explicit recording and authorized review/approval (`accept_hold`, `reject_return`, `adjust_po`) without silently altering PO lines.
6. **Supplier return:** Added `supplier_returns` separate from customer returns; identifies supplier/receipt, held goods, authorized review, outbound custody tracking, and reconciliation without releasing held goods to available stock.
7. **Putaway tasks:** Added `warehouse_tasks` with scan/ID confirmation, source and destination, assignment, physical placement, and verified restriction/capacity compatibility.
8. **Replenishment:** Added `location_replenishment_policies` with configurable min/target per picking location, reserve-to-pick task generation, duplicate-open-task prevention, and hold/reservation checks.
9. **Inter-warehouse transfer:** Added `transfer_orders` and `transfer_lines`. Dispatch from source creates `in_transit` inventory; destination receipt removes transit and creates destination stock; supports partial/damaged receipts; never shows inventory available in both warehouses simultaneously.
10. **Opening inventory and imports:** Multi-entity CSV import pipelines (`csv_imports`, `csv_import_errors`) for customers, suppliers, locations, orders, expected receipts, and opening stock with dry-run/preview, error reports, and separate cut-over date reconciliation for opening stock.
11. **Onboarding and configuration:** Added `warehouse_onboarding` and `policy_snapshots` supporting guided, resumable warehouse setup (goods profiles, staff, schedules, label preferences, imports, opening balances, readiness review) and immutable policy snapshots at consequential transactions.

Verification: P1 test suite PASSED (`tests/p1-inventory-inbound.test.ts`, 11/11 tests, 100% pass rate); full test suite PASSED (`npm test`, 125 tests: 123 passed, 0 failed, 2 skipped: 1 native PostgreSQL skipped, 1 tesseract skipped); strict TypeScript check PASSED (`tsc --noEmit`, 0 errors); production bundle build PASSED (`vite build` in 511ms); all verify checks clean (`npm run verify`).
Limits: Native PostgreSQL independent-client concurrency, native migrations, and native restore remain BLOCKED pending provision of two disposable database URLs (`TEST_DATABASE_URL` and `TEST_RESTORE_DATABASE_URL`). Physical warehouse handheld terminals, physical cameras, and Bluetooth ring scanners remain unverified. Production readiness is not claimed.


