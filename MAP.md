apps/web: React task screens, shared styling, local draft storage.
apps/api: authenticated Express API and private uploads.
apps/worker: durable export queue worker.
packages/contracts: Zod command schemas.
packages/domain: decimal calculations, errors and state policy.
packages/database: SQL migrations and PostgreSQL/development adapter.
scripts: seed/migrate/backup/restore.
tests: domain and transactional API verification.
docs: architecture, invariants, contracts, decisions, UX and operations.
evidence: candidate verification output.

apps/web/src/CompanySetup.tsx: resumable company identity/locale/schedule workflow.
packages/domain/configuration.ts: authorized versioned configuration commands.
packages/domain/scheduling.ts: date-only weekday suggestions.
packages/database/sql.ts: quote/comment-aware migration splitting.
docs/CONFIGURATION.md, MIGRATIONS.md, ONBOARDING.md, READINESS.md: platform operation and candid gates.

packages/domain/context.ts, access.ts: server membership/warehouse resolution and audited access commands.
apps/web/src/AccessControl.tsx: context selector, warehouse identity and membership/grant workflow.
apps/web/src/draft-scope.ts, work-preservation.ts, DraftRecovery.tsx: scoped device capture/recovery.
packages/database/migrations/010_memberships.sql, 011_warehouses.sql: exact home membership and legacy namespace backfill with warehouse FKs.

packages/domain/csv.ts, imports.ts: bounded CSV parser, validation, private persisted previews, atomic product commit.
packages/contracts/imports.ts: product/import schemas and supported units/profiles.
apps/web/src/ProductImport.tsx: source/mapping, review, error reports and batch/device recovery.
packages/database/migrations/012_product_imports.sql: immutable source and typed import-product provenance links.

packages/contracts/inbound.ts, packages/domain/inbound.ts: scoped supplier and one-product expected receipt contracts and commands.
packages/database/migrations/014_inbound.sql: supplier, expectation and immutable physical box receipt links.
apps/web/src/Inbound.tsx: expected-arrival planning and physical box receipt on Receive & scan.

packages/contracts/traceability.ts, packages/contracts/offline-sync.ts: Zod contracts for quality quarantine holds, recalls, serials and offline sync mutations.
packages/domain/traceability.ts: quality quarantine hold placement/release, recall lifecycle, impact dossier analysis, backward/forward lineage, formula-neutralized CSV export.
packages/domain/offline-sync.ts: offline mutation queue, file-before-command dependency ordering, visible 409 conflict detection, rebase/retry/discard, bounded retries.
packages/database/migrations/018_traceability_recalls_offline_sync.sql: item_serials, lots extensions, quality_holds, recalls, sync_outbox tables and indexes.
apps/web/src/Traceability.tsx: integrated UI suite for quarantine holds, recall management, impact dossiers, lineage investigation, and scoped sync outbox.
tests/p2-traceability-recalls-offline-sync.test.ts: comprehensive domain and multi-tenant isolation test suite for P2 vertical slice.

packages/contracts/portal.ts, packages/contracts/notifications.ts, packages/contracts/adapters.ts: Zod schemas for client portal users/orders, event webhook endpoints/pings, and carrier/accounting adapters.
packages/domain/portal.ts: client portal context, balances, customer draft order submission, and tracked shipments.
packages/domain/notifications.ts: webhook subscription management, HMAC-SHA256 signature verification, delivery event dispatcher, and test pings.
packages/domain/adapters.ts: carrier manifest booking/generation with vehicle & pallet breakdowns, accounting ledger export with formula-injection neutralization.
packages/database/migrations/019_client_portal_notifications_adapters.sql: client_portal_users, notification_endpoints, notification_deliveries, carrier_manifests tables.
apps/web/src/PortalView.tsx: integrated client portal, webhooks settings, and carrier/accounting adapter export views.
tests/p3-portal-notifications-adapters.test.ts: end-to-end domain, multi-tenant isolation, webhook signature, and adapter export test suite for P3 vertical slice.
evidence/P3-PORTAL-ADAPTERS-001.md: raw test execution transcript and verification report for P3.
