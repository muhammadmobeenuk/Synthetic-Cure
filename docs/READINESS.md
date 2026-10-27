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
