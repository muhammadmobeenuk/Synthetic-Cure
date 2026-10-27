# PLATFORM-003 · atomic product catalogue CSV import

Base source: 7e9ace7e8ae87f5dee6e8d34e07d3efd11fd97f1, clean before this slice. One working agent; sequential architecture, inventory/security, UX, backend/frontend and QA perspectives. No operational database reset. Exact implementation candidate recorded in IMPORT-SOURCE.txt; package verification appended separately.

## Working slice
Administrator uploads/pastes bounded UTF-8 comma CSV, explicitly maps columns and saves private original evidence/preview. Review rows/ignored columns and download safe errors. Create-only typed products, Unicode/leading zeros retained. No stock, price, pack conversion or handling/temperature inference. Commit revalidates current company catalogue and creates all products/typed provenance links plus immutable audit events transactionally. Same-file/mapping deduplication, operation replay, stale versions and cross-scope access are protected. Reload recovery through saved batches; scoped device source/mapping captures are not sync. Additive migration 012 and backward-compatible v4 backups preserve originals/history.

## Checks
PASSED baseline: npm run verify, 71 checks, 70 passed, zero failed, one native-only skipped; TypeScript/build. Raw import-baseline.txt.
PASSED expanded: npm run verify, 84 tests, 83 passed, zero failed, one native-only skipped; TypeScript/build. Raw import-verification.txt. One earlier full attempt ended without a final test summary and was not counted. The first completed expanded attempt exposed two test fixture mistakes (direct service receipt missing schema defaults; reuse of rotated session). Fixtures corrected, final complete run passed; no authorization relaxation.

Parser tests: BOM, CRLF, quoted comma/escaped quotes/multiline, bilingual values/zero codes; malformed quote/header/oversize/NUL/replacement character/row limits; duplicate/out-of-range mapping, unknown unit/profile, duplicate/whitespace SKU; spreadsheet formula neutralization.
Workflow/DB/HTTP: zero product/stock changes in preview; original preservation/hash; duplicate operation/file; exact IDs on replay; downstream receipt and immutable provenance; bad rows prevent all inserts; current-catalogue conflict retains source; competing overlapping commits; HTTP role/warehouse/company report/read/list/commit isolation; rollback of every product/link/event after simulated second insert failure with successful same-operation retry; v4 restore and legacy v3 empty imports; genuine pre-membership v2 restore retained.

BLOCKED native PostgreSQL locking/concurrency/migration/restore: no two disposable database URLs. PGlite results never substitute for native proof. One native-only test skipped, not passed. Build warns main JS chunk exceeds 500 kB; measured scale/performance remains unverified.

## Browser · full Express API + persistent PGlite
PASSED desktop manual fallback: pasted synthetic two-row CSV with unsupported boxes unit and an old_price column. Explicit column mapping, source/reason; saved preview 6edaaaec-fbf4-44ab-a29b-c9e09fdade36 showed 2 rows/1 valid/1 invalid, ignored price and disabled commit. Error report download completed through browser download event. Corrected unit to piece, saved batch 6829d2c6-c312-4e1a-abcd-cb3e66ad9831, explicitly committed both products (v2). Reopened validation and reloaded catalogue: SKU 000-QA-003 and 001-QA-003, Chinese names, exact quoted English name, unconfirmed conversions/handling retained. Screenshot warehouse-import-003.jpg inspected and saved.
BLOCKED file chooser: browser waitForEvent(filechooser) timed out after 10000ms and reset automation kernel. Recovered the same tab; no new-tab loop. Did not claim file upload passed; paste fallback verified. One disabled preview click after hot reload timed out; fresh state showed mappings empty, explicitly remapped and succeeded. These failures were not counted as successful actions.
BLOCKED external 12ui design review: automatic approval review rejected transmitting local warehouse screenshot/design prompt to external 12ui.com without explicit authorization. No retry/bypass. Existing application design reused; no external result claimed.

## Limits / next
Not production ready. Product imports are bounded, synchronous and create-only; other import types, unit aliases, large files, safe product correction/bulk reversal and opening stock need separate workflows. No customer documents or current prices used. Next: customer/destination CSV import, then independent cut-over inventory reconciliation after required ownership/stock rules are validated.
