# Platform audit · 26 October 2026

Inspected source candidate f03da2c. Baseline reproduced: npm run verify, 47/47 tests, TypeScript and Vite production build PASS. Raw log: platform-baseline.txt. VERIFIED means the stated bounded automated test, not all devices or native PostgreSQL.

| Requirement | Existing implementation / status | Evidence | Gap | Priority |
|---|---|---|---|---|
| Receipt, identity, contents, movement | VERIFIED on PGlite/HTTP | workflows.test.ts receipts/moves/replay | Native simultaneous clients not proved | P0 |
| Private photo upload | PARTIAL | signature/size/retry/authorization HTTP tests | Real browser selection/upload not reproduced | P0 |
| Pallets and quantities | VERIFIED on PGlite | membership/location/repack tests | Native races, multi-product outbound limits | P0 |
| Orders, preparation, partial dispatch | VERIFIED on PGlite/HTTP | tests stage, mixed customer, wrong box, partial | Wednesday hardcoded in UI; unknown policies remain | P1 |
| Delivery, held returns, counts | PARTIAL | handover/return/count tests | Repeated mixed returns need reconciliation | P2 |
| Authentication and object access | PARTIAL | session/CSRF/driver/foreign ID tests | Composite company FKs missing; staff lifecycle incomplete | P0 |
| Exports and jobs | BROKEN permission boundary | jobs/result denies drivers only; worker does not reauthorize | Current export permission must be enforced | P0 |
| Company separation | PARTIAL | org_id API filtering | Ordinary FKs permit cross-company links; one company/user | P0/P1 |
| Recovery | BROKEN occupied-file recovery boundary | restoreBackup copies files before DB empty check | Consistent snapshot, no-overwrite staged restore, native drill | P0 |
| Native PostgreSQL | NOT TESTED | server absent; runuser rejects setgroups | External disposable server required | P0 BLOCKED |
| Device layouts | NOT TESTED this audit | historical limited product viewport inspection | Repeat critical journeys, upload and camera states | P0 |
| Company configuration/onboarding | MISSING | hardcoded JadeSun/timezone/labels, no configuration table | Typed/versioned settings, resumable steps | P1 |
| Multi-warehouse/stock owners | MISSING | locations only; customer is not stock owner | Preserve unknown ownership, no arbitrary company backfill | P1 |
| CSV import/opening stock | MISSING | manual catalogue only | Mapping, dry-run, atomic commit/reconciliation | P1 |
| Loose quantity inventory | PARTIAL | loose picks from boxes to order containers | Quantity stock without artificial containers, ledger/balances | P1/P2 |
| Inbound expectations/suppliers | MISSING | manual unexpected receipts only | Supplier, PO/receipt, inspections, putaway | P2 |
| Tasks/replenishment/transfers | MISSING | direct domain operations | Transactional tasks and in-transit transfer workflow | P2 |
| Product traceability/holds | PARTIAL | per-product lot/date/temp and box issues | Serial/weight profiles, complete trace/recall/export | P2 |
| Offline drafts | VERIFIED limited implementation | IndexedDB + replay API tests | User-only scope, no automatic queue; no offline final dispatch | P3 |
| Automatic sync/OCR | MISSING | UI correctly says unconfigured/drafts only | Adapters/outbox/provider verification | P3 |
| Operational reports/performance | PARTIAL | bounded lists, export of boxes | Defined stock quantities, indexed pagination and benchmarks | P3 |
| Production readiness | NOT TESTED | development candidate only | Native restore/concurrency, staff policy, monitoring, devices | Gate |

No real data resets authorized or performed. No runtime company/warehouse/ownership guesses will be used to make screens appear complete.

## Remediation in PLATFORM-001
Baseline BROKEN export and occupied-restore boundaries are fixed and regression-tested. Company-aware FKs and a preservation/backfill rehearsal are implemented (PGlite evidence). Three versioned company settings steps and configurable schedule suggestions now work; broader onboarding remains PARTIAL. Native PostgreSQL stays NOT TESTED/BLOCKED. Browser upload and representative device results are in PLATFORM-001.md; do not infer native or physical-device success from them.

## PLATFORM-002 remediation
Company memberships, server-validated context switching and explicit warehouse grants now work. Operational records/reads/files/jobs/exports carry warehouse scope; composite constraints prevent cross-warehouse relationships. Exact legacy namespace/home membership backfill and v2/v3 restore are covered. Membership/grant revocation, stale context and last-administrator races are tested (PGlite/HTTP). Identity invitations/password lifecycle and all native PostgreSQL gates remain incomplete. Current evidence: PLATFORM-002.md.
