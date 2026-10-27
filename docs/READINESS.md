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
| Staff lifecycle, membership and warehouse access | NOT RUN / incomplete | Implement and object-access test |
| Full onboarding/import/opening reconciliation | NOT RUN / incomplete | Atomic validated workflows |
| Inventory without containers, serial/weight ledger | NOT RUN / incomplete | Typed balances/ledger design and tests |
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

