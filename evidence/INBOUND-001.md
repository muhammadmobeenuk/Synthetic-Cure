# Expected inbound candidate

PASSED: npm run verify after fixes: 101 passed, 0 failed, 1 native PostgreSQL-only skipped; strict typecheck and frontend build passed. PGlite tests cover expected planning without stock, partial confirmed and damaged/held receipts, same-operation replay, over-receipt rejection, stale version, warehouse isolation, unit mismatch, immutable receipt history, driver and operator permissions, tracked-product hold/pending behavior, and database restore of inbound records. An initial recheck had five failures caused by an existing worker test assuming the target job was processed first, causing a revoked grant to leak into later tests. The test now waits boundedly for its target and restores the grant in finally; final run passed.

BLOCKED: native PostgreSQL integration, migration and restore; no disposable native databases available.

NOT RUN: browser workflow, physical phone/tablet, live preview, photo upload via inbound, and an extracted ZIP setup exercise. No actual supplier, price, stock, batch or temperature has been invented. Expected/accepted/held/pending counts reflect receipt-time classifications; later disposition is not recalculated. Over-delivery, cancellation, editing, multi-line purchase orders, unexpected delivery and supplier returns are not implemented. These source changes have not been deployed.
