# Sign-out draft protection

Candidate: working tree after sign-out draft protection; see git diff.

PASSED: npm run verify — typecheck, 94 tests passed, one native PostgreSQL test skipped, production frontend build. Tests cover capture-before-check, cancellation, capture/lookup/server failures, and no-draft sign-out.

BLOCKED: native PostgreSQL concurrency — PostgreSQL binaries and disposable test URLs unavailable.

NOT RUN: browser sign-out with an open form, physical device storage errors, phone/tablet interaction. Test cases use injected actions and do not prove IndexedDB behavior. Network response loss after server sign-out can leave session state uncertain; drafts remain on device.

Known limitation: only forms registered with work preservation are captured; this is not automatic offline sync. Cleanup failure after confirmed sign-out may leave local data. No claim of production readiness.
