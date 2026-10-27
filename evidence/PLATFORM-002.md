# PLATFORM-002 · authenticated company and warehouse access

Base: 5c0d669. Source SHA and package evidence are recorded separately in ACCESS-SOURCE.txt. Existing source changes were clean at task start; one working agent, sequential architecture/inventory/security/UX/QA review. No operational database reset.

## What works

- One identity, multiple explicit company memberships with per-company roles. Stable user IDs/home provenance remain; historical actor keys reference membership, never a reassigned user record.
- Versioned/audited administrator membership and warehouse-grant changes. Unknown legacy roles remain stored for review but grant no active session. Last active administrator guard uses company row locking before membership locks.
- Create/review warehouse identity; preserved legacy namespace is explicitly unconfirmed. No dimensions/capacity/address invented. Additional membership grants no warehouse automatically; home provisioning compatibility is documented in ACCESS.md.
- Server-validated context selection/session rotation/CSRF. Operational object scope and warehouse relationships enforced in domain/API/DB. Current role/grant checked in command transaction before idempotent replay; jobs reauthorize before exporting. Cross-warehouse ordinary moves are blocked.
- Scoped workspace/search, documents/labels, orders/allocations/preparation/trips/shipments, counts/review, audit/jobs/exports. Company-wide catalogue identity and administrator product policies stay distinct from warehouse physical work.
- Stale-tab context headers reject writes before commands. Device drafts/cache scoped by company/warehouse/user; legacy fallback is original home legacy namespace only. App navigation/context changes preserve receipt/count work and reviewable task/config/access captures. These are not a sync queue. Logout warns and clears this identity's drafts only after server logout.
- Complete v3 dimension restore and legacy v2 home-namespace restore; no duplicate bootstrap rows. Existing DB-plus-file restore tests remain.

## Automated checks

PASSED: baseline 58 checks: 57 passed, one native-only skipped (access-baseline.txt).
PASSED: current 71 checks: 70 passed, zero failed, one native-only skipped; strict TypeScript and Vite build (access-verification.txt).

New checks cover scoped creation/receipt/replay; forged client scope; cross-warehouse reads/search/documents/labels/movements/FKs/jobs; membership with no implicit grant; grant revocation before cached replay; unauthorized context switching; last-administrator/stale updates; scoped order/allocation/preparation; one identity switching roles across companies; revoked membership recovery/logout; queued export revocation; v3 restore; legacy v2 restore; device scope fallback; stale browser context guard; competing administrator demotions; unmapped legacy role.

BLOCKED: native PostgreSQL locking/concurrency and native restore. No two disposable PostgreSQL database URLs are configured. The native-only backend identity test is skipped, never counted as a pass. PGlite serialization is not native concurrency proof.

## Browser evidence · full Express API and persistent development PGlite

PASSED desktop: created QA-SECOND, named "Synthetic second warehouse · browser QA", address left unknown, reason explicitly synthetic. Server confirmed, creator grant recorded.
PASSED context/draft journey: started a receipt in legacy namespace with RCV-01 and source text "Synthetic legacy-only draft · preserve across workspace switch"; navigated to Settings (device capture preserved); switched to QA-SECOND with regenerated session. Its receipt locations were empty and Restore draft reported "No saved receipt draft". Switched back to legacy, restored the original location and exact text. No additional receipt was created by the draft or switch.
PASSED explicit grant: assigned Demo Operator to QA-SECOND with reason; server confirmed and effective active-grant count changed from 1 to 2.

The initial browser transport HTTP failure recovered after documented troubleshooting. One Settings locator timed out after a sidebar action; fresh state inspection and normal Settings navigation recovered without creating more tabs or changing app data. Development WebSocket/extension metadata errors were observed; no successful backend action is inferred from those errors.

Representative phone/tablet visual inspection, final package and hosted-demo checks are appended when completed. These are synthetic records; no physical-device or native-database certification is claimed.

## Remaining limits / next task

Not production-ready. Native gates, staff identity invitations/password lifecycle, real permission/approval policies, stock-owner clients, inter-warehouse transfers, serial/variable-weight ledger, validated imports/opening cut-over, automatic sync/OCR, measured performance/retention/recovery and physical-device checks remain.

Next bounded task: atomic CSV catalogue import with mapping, preview, validation, dry run, explicit commit/error report and scope checks. Opening inventory remains a distinct cut-over/reconciliation workflow.

PASSED representative layouts: inspected actual 390×844 phone and 768×1024 tablet iframes. The access selector/actions/cards fit inspected states; full selected company/warehouse names are also displayed beneath native dropdowns. At phone width opened warehouse identity review, selected the legacy warehouse, entered an explicitly unsubmitted synthetic name and cancelled through reachable controls. No identity change was committed by this layout check. These are browser viewport inspections, not physical-device/camera certification.

PASSED source package: ZIP CRC/path checks; no runtime/node_modules/.env in archive; extracted a clean directory; ran documented npm ci (192 packages) and npm run verify. 71 checks: 70 passed, zero failed, one native-only skipped; TypeScript/build passed. Raw evidence access-package-install.txt and access-package-verification.txt. A bounded scan of built frontend assets found none of SESSION_SECRET, ADMIN_PASSWORD, DATABASE_URL or private-key headers; no universal secret-detection claim.
