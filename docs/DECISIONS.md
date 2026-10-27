# Decisions

1. Empty repository: React/Vite/TypeScript, Express, PostgreSQL-compatible SQL modular monolith. SQL migrations and parameterized node-postgres queries are used directly; no unused ORM layer.
2. Runtime lacks PostgreSQL and system install fails (setgroups/seteuid operation not permitted). Development uses persistent PGlite. Production requires DATABASE_URL. Native PostgreSQL concurrency tests remain blocked unless a database is supplied. PGlite writes serialize in one process; PostgreSQL uses row locks and advisory transaction idempotency locks.
3. Local implementation follows the brief's local stages. No deployment of a substituted D1 backend. Hosting PostgreSQL requires an external server and private file volume.
4. Proposed roles are configuration, never asserted real staff policy. Demo session explicitly restricted to development, synthetic organization only. Production login uses provisioned password and maintained express-session/bcrypt components.
5. Box location is direct only when standalone. Attached boxes inherit pallet location. Removal explicitly places only the removed unit. Pallet nesting is not supported, eliminating cycles.
6. Offline drafts only initially. No authoritative offline dispatch. OCR unconfigured; manual entry is functional. No inferred conversions, prices, storage or optimization.
7. 12ui attempted; generation blocked by required account sign-in. Supplied design tokens guide original UI. Native design alignment unavailable.

## Audit 002 · user responses
Both picking methods are required. Loose picking transfers quantity into an explicit order-specific physical picking/packing container; repeated compatible picks reuse that identity. This avoids treating a partly used source box as dispatched. Containers cannot silently mix batches or absorb unallocated existing stock.
Food tracking is per product; the application invents no batch, expiry, measurement or temperature limit. Configured requirements are enforced; incoming records with missing required fields can still be captured as unconfirmed for review.
Ordinary dispatch needs a verified address. An appropriately authorized supervisor may record an explicit address exception and reason. Actual permission limits still require business confirmation before production use.

## Platform audit 001
- Preserve the working stack/identifiers/audit history. Add validated company FKs; ambiguous legacy links abort instead of assigning them to a guessed company.
- Three foundational onboarding steps ship as one working saved workflow. Do not present them as complete staff/warehouse/import onboarding. Existing real-company policy remains unconfirmed.
- Scheduling is date-only, configurable and suggestive. Empty batches are explicit and never duplicate orders. New batches retain versioned policy; no guessed backfill of historical snapshots.
- Restore uses exclusive fresh DB/files targets and private staging. Handled errors roll back; crash-orphan directories require explicit review. Native PostgreSQL proof stays blocked until two disposable databases are supplied.
- Scope device drafts by company and user, preserve legacy drafts for the existing single-company identity, warn before logout, and never erase drafts because server logout failed. No automatic sync claim.

## PLATFORM-002

- Keep `users.org_id` as home provenance; add explicit versioned memberships rather than moving user records between companies. Current role comes from membership. Retain revoked rows for history.
- Preserve existing single namespaces as explicitly unconfirmed legacy warehouses, not inferred physical geometry/addresses. Bootstrapped historical grants retain existing access. Additional memberships require explicit warehouse grants.
- Apply warehouse identity to operational records and constrain parent/child relationships at the DB. Company-wide catalogue/configuration stays separate from warehouse operations; administrator product-policy changes invalidate checks in every affected box's true warehouse scope.
- Use context headers as stale-tab preconditions, never tenant authority. Switching rotates secure sessions and CSRF; drafts use full context. App navigation saves active receipt/count drafts; browser reload still needs explicit save.
- Keep inter-warehouse transfer, stock-owner clients, invitations and automatic sync out of this slice rather than simulating them.

## PLATFORM-003
Create-only product imports first, using administrator configure permission pending approved staff limits. Strict existing units/profiles; no alias/conversion guessing. 256 KiB/500 rows/40 columns limits bound synchronous work. Identical source+mapping+policy deduplicates within company/warehouse; SKU uniqueness remains company-wide. Native commit locks products for bounded revalidation+insert; native proof remains blocked. Originals retained privately in DB; no public originals or executable CSV. No destructive bulk reversal; downstream history must remain.
