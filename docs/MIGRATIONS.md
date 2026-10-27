# Migration and preservation procedure

Never reset a working database. Take and verify a DB-plus-file backup, stop application/worker writes, rehearse on a separate restored copy, run `npm run db:migrate`, then run readiness/workflow checks before resuming. Retain the prior application artifact and pre-migration backup. Native PostgreSQL rehearsal remains a release gate.

008_company_integrity.sql adds company-aware composite keys and foreign keys. It inherits preparation membership company only from its existing preparation and verifies the referenced order has the same company. Cross-company links cause the transaction to abort. No records are assigned to an arbitrary company, deleted or moved. Investigate invalid legacy links using a read-only query; reconcile them with an explicit approved business correction before retrying. Constraint validation may lock large tables; plan a maintenance window and inspect PostgreSQL execution/locking behaviour on representative data.

009_company_configuration.sql preserves all identities/history and adds typed configuration/revisions and nullable preparation snapshots. Existing company names are retained. Locale and schedule stay unconfirmed, except for the explicitly known synthetic demo. Historical preparations are not retroactively assigned guessed policies.

The PGlite migration splitter supports quoted semicolons, identifiers, nested comments and dollar-quoted functions. Native PostgreSQL executes the original migration file transactionally. Migrations run from one controlled deployment process; concurrent migration runners are not supported.

Automated rehearsal constructs a populated 001–007 candidate, upgrades it and verifies box/customer/order identifiers, leading zeros, Unicode, membership and original audit events. An intentionally ambiguous preparation membership aborts 008 with no partial schema/backfill. This is PGlite evidence, not a PostgreSQL locking proof.

Rollback: prefer an application rollback only if it is compatible with the additive schema. Never drop new columns/history to force compatibility. For incompatible rollback, restore the verified pre-migration database AND matching file bundle to fresh targets, verify and then switch the deployment. Do not restore over a live target.

## PLATFORM-002: 010 and 011

010 backfills exact home memberships from existing user/company relationships, retaining original user IDs/fields and audit actors. It rejects case-insensitive duplicate login emails instead of choosing an identity arbitrarily. Actor/driver foreign keys reference memberships, so one identity can act for multiple authorized companies while historical links remain valid.

011 creates one explicitly labelled legacy namespace per original company; this reflects the old application's single namespace and makes no claim about actual physical identity, address or capacity. All existing operational rows receive that namespace and retain IDs, timestamps, quantity data and event payloads. The immutable-event trigger is removed/recreated **inside the migration transaction solely to backfill the new warehouse metadata column**; original business event content is not edited. This structural backfill is recorded here rather than silently rewriting movement meaning. New relationships get company/warehouse composite keys. New warehouse identity is explicitly reviewed/created in Settings.

Back up before running these migrations and rehearse on a restored copy. A legacy namespace is not a verified mapping for importing unrelated warehouses. Use an explicit transfer/cut-over process for such stock later.

Backup v3 includes warehouses, memberships and grants before dependent operational records. Restore suppresses compatibility bootstraps using a transaction-local flag only for complete v3 dimension records. v1/v2 archives bootstrap their original home namespaces and grants. The flag is not an authorization mechanism and is never session-global. Missing subsets of access tables are rejected.

Security rollback: an older binary that ignores these scopes is incompatible with live multi-warehouse/multi-membership data. Restore the complete pre-upgrade DB/files into fresh targets and verify before routing the old release, or use a tested scope-aware rollback release. Do not remove membership history or new columns to force compatibility.

## PLATFORM-003: 012
012_product_imports.sql is additive: creates empty import batches/provenance links, composite company/warehouse/actor keys and append-only source/link guards. Existing products/events/stock are untouched. Startup on the persistent synthetic candidate successfully applied this migration. Snapshot format v4 includes both new tables after referenced dimensions/products. v1–v3 backups restore with empty imports when both tables are absent; partial import table sets are rejected. Rehearse DB+file restore to fresh targets before deployment. Older releases cannot back up new import history; use a compatible rollback or full pre-upgrade recovery.

013 creates pallet planning groups and membership history with company/warehouse foreign keys and one-active-group-per-pallet constraint. It does not modify existing stock. Snapshot v5 includes both new tables; v1–v4 restore with both absent, and incomplete table pairs fail validation. Rehearse migration and database-plus-file restoration on disposable native PostgreSQL before production.
