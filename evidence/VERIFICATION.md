# Verification · JADESUN-LOCAL-001

Status categories: PASSED / FAILED / BLOCKED / NOT RUN. Source candidate is recorded in SOURCE.txt after the source commit.

| Check                              | Status  | Evidence / scope                                                                                                      |
| ---------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| TypeScript strict checking         | PASSED  | npm run typecheck; no diagnostics                                                                                     |
| Domain + PGlite + HTTP suite       | PASSED  | 35 tests; evidence/verification.txt                                                                                   |
| Production frontend build          | PASSED  | npm run build                                                                                                         |
| Native PostgreSQL server           | BLOCKED | No PostgreSQL binary; apt-get rejected setgroups/seteuid (operation not permitted)                                    |
| Native multi-client concurrency    | BLOCKED | No native PostgreSQL URL. PGlite concurrency tests serialize one development process and do not prove native locking  |
| Authenticated desktop overview     | PASSED  | Browser displayed authoritative 8 boxes / 2 pallets / 3 open orders / 1 review issue before QA receipt                |
| Desktop manual receipt             | PASSED  | UI created BOX-A993659C, 12 piece, RCV-01; source text and received event visible                                     |
| Browser photo chooser              | BLOCKED | cua_repl/js timed out awaiting tools/call after 300s; no successful browser photo upload claimed; no tab-opening loop |
| Private photo API                  | PASSED  | Signatures, size, duplicate retry, authorized bytes, anonymous/driver/foreign denials, storage-failure recovery       |
| Phone/tablet screenshot inspection | BLOCKED | Browser automation stalled before responsive visual checks; CSS breakpoints are implementation, not visual evidence   |
| Offline automatic sync             | NOT RUN | Not implemented; candidate supports explicit device drafts only                                                       |
| Production deployment/readiness    | NOT RUN | Local candidate only; staging gates remain                                                                            |
| 12ui generated design alignment    | BLOCKED | CLI requested account sign-in; original UI follows supplied visual system                                             |

## Required scenario mapping

| #   | Scenario                                   | Status | Evidence / precise boundary                                                                           |
| --- | ------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------- |
| 1   | Duplicate receipt creates one box          | PASSED | Same operation replay returns original ID                                                             |
| 2   | Duplicate scan does not increase box count | PASSED | Manifest load replay and unique count observations                                                    |
| 3   | Competing last-stock allocation            | PASSED | One valid allocation in PGlite test; native PostgreSQL proof BLOCKED                                  |
| 4   | Competing box move                         | PASSED | One succeeds; other receives recoverable 409 with current version; native proof BLOCKED               |
| 5   | Pallet movement inherits location          | PASSED | Both children follow effective location                                                               |
| 6   | Remove one box preserves others            | PASSED | Remaining membership/location unchanged                                                               |
| 7   | Mixed-customer permitted loading           | PASSED | Two customers, one pallet/trip, two shipments dispatched                                              |
| 8   | Wrong shipment box rejected                | PASSED | WRONG_SHIPMENT; no movement                                                                           |
| 9   | Unknown pack size creates no total         | PASSED | Null quantity and pack size preserved; cannot allocate                                                |
| 10  | Wednesday ready does not dispatch          | PASSED | Box confirmed, shipment ready, no trip created                                                        |
| 11  | Wednesday does not repeat orders           | PASSED | Batch selection/add/remove/carry preserve order count                                                 |
| 12  | Checked content/order changes need recheck | PASSED | Manifest invalidation + checked order amendment block loading                                         |
| 13  | Partial delivery outstanding quantity      | PASSED | 6 delivered, 4 outstanding of 10                                                                      |
| 14  | Returned stock unavailable                 | PASSED | Returned/hold until authorized disposition; only 4 returned kg released                               |
| 15  | Offline replay cannot duplicate movement   | PASSED | Server idempotency replay tested; real automatic offline outbox is NOT RUN                            |
| 16  | Upload failure recoverability              | PASSED | Receipt survives storage failure, duplicate attachment returns one document; browser recovery BLOCKED |
| 17  | Private/foreign access denied              | PASSED | HTTP session/CSRF/role/organization tests, real foreign document ID                                   |
| 18  | Driver reassignment history                | PASSED | Actual API command retains from/to/reason event                                                       |
| 19  | Cancellation releases allocations          | PASSED | Allocation rows released; cancelled order retained                                                    |
| 20  | Repacking conserves quantity               | PASSED | 20 = 12.75 + 7.25, distinct new box identity                                                          |
| 21  | London daylight-saving dates               | PASSED | Both spring/autumn boundaries and UTC timestamps                                                      |
| 22  | Backup actually restores                   | PASSED | Fresh PGlite target, domain/event counts and private bytes match; native restore BLOCKED              |

## Additional checks

Cross-customer destinations require explicit supervisor authorization. Approved partial dispatch splits outstanding unloaded goods without double-counting. Operational text/status token combinations tested at 4.5:1 normal-text contrast. Database events reject UPDATE/DELETE. Transaction failures roll back partial receipts. Export worker produces an authoritative completed snapshot.

## Security review limits

Parameterized queries; allowlisted dynamic tables/columns; server-derived actor/org; private storage with UUID keys and signature validation; session cookies HTTP-only/strict and secure in production; production demo disabled; no imported customer documents; no credentials in source. This is a scoped code/test review, not a penetration-test or production approval.
