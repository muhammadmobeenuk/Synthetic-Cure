# Unconfirmed API response recovery

PASSED: full npm run verify, 100 passed, zero failed, one native PostgreSQL test skipped. Following a small error-envelope change, focused tests/api-response.test.ts (4/4), typecheck and build passed. Tests simulate successful JSON, structured 409/422, malformed/empty successful responses, HTML 400/502, unexpected JSON error bodies and failed network requests. Unknown error responses are classified as status 0 to prevent existing form logic from treating a possibly committed request as a definitive 4xx rejection.

BLOCKED: native PostgreSQL integration/concurrency (PostgreSQL and two disposable URLs unavailable).

NOT RUN: browser or device tests, real proxy/response loss after an actual committed operation, or updated hosted demo. The test stubs fetch; it does not prove every form preserves operation IDs or that device drafts can always be saved. Automatic offline sync remains unimplemented. No production-readiness claim.
