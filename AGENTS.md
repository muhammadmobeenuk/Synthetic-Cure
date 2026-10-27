# JadeSun Warehouse

Use one agent. Read PROJECT.md, STATE.md, tasks/CURRENT.md and relevant modules.
Commands: npm ci; npm run db:migrate; npm run db:seed; npm run dev; npm run verify.
Preserve user changes. Keep actors and organization server-derived. No stock changes from OCR.
Domain invariants: stable box identity; at most one pallet; standalone location versus inherited pallet location; unknown quantities stay null; product-specific verified conversions only; transactional idempotent commands; stale versions return 409; audit events are append-only; ready is not dispatched; returns held.
Before a slice: acceptance, failures/recovery, contracts, implementation, verification, state update.
Report PASSED / FAILED / BLOCKED / NOT RUN honestly. Do not claim production readiness.

Platform boundaries: active company/role/warehouse are server-validated memberships/grants, rechecked in command transactions before replay. users.org_id is home provenance, not active tenancy. Operational records have company/warehouse FKs. Do not implement cross-warehouse moves without a transfer domain. Configuration/policy snapshots retain meaning. Restore never overwrites files; v3 access tables must be complete. Use two disposable URLs for test:postgres; skipped native checks are not passes. Read docs/ACCESS.md, READINESS.md and evidence/PLATFORM-002.md.

Import boundary: product CSV is create-only, company catalogue with explicit warehouse provenance. Preview changes no products/stock; commit revalidates atomically. Original source, mapping and links are immutable. Read docs/IMPORTS.md; no opening stock or guessed conversions.
