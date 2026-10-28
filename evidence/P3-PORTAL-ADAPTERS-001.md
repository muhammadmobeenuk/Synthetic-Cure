# P3 Client Portal, Webhooks & Notifications, and Carrier/Accounting Adapters Candidate

PASSED:
- P3 dedicated test suite (`tests/p3-portal-notifications-adapters.test.ts`): 6 passed, 0 failed.
  - P3.1 Client Portal: user linking to customer, scoped stock-owner inventory queries, draft customer order placement with destination authorization check.
  - P3.2 Multi-tenant isolation & security: second company cannot access portal data, spoof customer ID, or view foreign inventory.
  - P3.3 Webhooks & Notifications: endpoint registration, HMAC-SHA256 signature generation (`X-Synthetic-Signature`), delivery logging, and test ping dispatch.
  - P3.4 Carrier Manifest Adapter: vehicle, pallet, box count, and stop breakdowns in structured JSON and CSV formats.
  - P3.5 Accounting Export Adapter: verified physical quantities, unit breakdown, formula-injection neutralization (`=`, `+`, `-`, `@`), and unverified pricing notice.
  - P3.6 Database Migration & Logical Backup v8: tables `client_portal_users`, `notification_endpoints`, `notification_deliveries`, `carrier_manifests`, backup format `jadesun-v8` with full backward restore compatibility for v1 through v7.
- Full regression test suite (`tests/*.test.ts`): 145 tests: 143 passed, 0 failed, 2 skipped (1 native PostgreSQL skipped, 1 tesseract skipped). Duration: 39.9s.
- TypeScript compiler (`tsc --noEmit`): 0 errors.
- Vite production bundle build (`vite build`): built in 598ms, 0 errors.

BLOCKED:
- Native PostgreSQL integration, race/concurrency checks, and database-plus-private-file restore on two distinct disposable databases (`TEST_DATABASE_URL` and `TEST_RESTORE_DATABASE_URL` not configured in environment).

NOT RUN / UNVERIFIED:
- Real production webhook delivery to live external endpoints (mock HTTP/fetch used in automated test harness).
- Live electronic carrier API dispatch (manifest generation and booking persisted locally).
- Physical warehouse handheld scanners and mobile thermal label printers.
- Deployed preview environment update.
