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
