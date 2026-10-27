# Synthetic Cure · Warehouse Operations

A persisted warehouse application for receiving, bilingual stock records, packing, dated preparation and flexible delivery, with versioned company identity/locale/preparation settings. The development workspace uses clearly marked synthetic records.

## Start the synthetic demo

1. Install **Node.js 24 LTS** (Node 22.12+ is supported).
2. Extract this folder and open a terminal inside it.
3. Run:

```sh
npm ci
npm run dev
```

4. Open **http://localhost:3000**.
5. Select **Enter demo workspace**. Alternative demo roles are Operator, Reviewer and Driver.

The application creates an isolated, visibly synthetic workspace. Records persist in `runtime/database` after reload/restart. No real customer documents, prices, routes or staff identities are included. A Wednesday preparation sample is dated 28 October 2026; it does not imply a delivery date.

## First working workflow

1. **Receive & scan** → select a customer if known and a physical location.
2. Preserve any printed label as source text.
3. Select a product and enter a quantity in its base unit, or leave it unknown. Tick physically verified only after checking.
4. Capture/upload a JPEG, PNG, WebP or PDF, or attach it later.
5. Select **Confirm & receive box**. The server creates one stable internal ID.
6. Open the box record, print its label, move it with a reason, and reload. Find it in **Boxes**. Its movement history is retained.

Save draft stores a local draft only. If an upload fails, the receipt remains and retry attaches the file without receiving another box.

## Prepare and deliver

- Create internal customers/destinations/products/locations if needed. Cross-customer receiving needs an explicit authorized destination relationship.
- Create an order. Allocate a whole verified single-product box; repack first if a split is needed. Quantities never use an assumed case conversion.
- Create a preparation batch by date and explicitly select orders. Add/remove unprocessed orders or carry the same unfinished batch forward with a reason.
- Advance To prepare → Picking → Packing → Checking → Ready. Moving to Packing records allocated whole boxes as picked. Physically move goods to staging before Ready.
- Build mixed-customer pallets, add/remove boxes, move the pallet and check its current manifest. Membership/content changes invalidate the check.
- Readiness creates a shipment. Plan its delivery trip independently; assign a driver and vehicle. Stops are manually ordered, with no invented routing estimate.
- In Dispatch, enter internal box IDs against the shipment manifest. An unrelated box is rejected. Dispatch records custody handover, not final delivery.
- Supervisors can approve a partial dispatch: unloaded lines move to a separate outstanding shipment with no assigned trip. Nothing is double-counted.
- Sign out and choose Driver demo to record quantities delivered/returned. Partial handover retains outstanding quantities. Return stock stays held until inspected by a supervisor.
- Count & reconcile records unique observed IDs and submits discrepancies for review without adjusting stock automatically.

## Verify

```sh
npm run verify
```

Runs strict TypeScript checking, domain/database/HTTP tests and a production frontend build. See `evidence/PLATFORM-002.md` for current results, browser limits and the native PostgreSQL verification boundary.

For native PostgreSQL tests, supply **an isolated empty test database**, then run `npm run test:postgres`. The suite seeds synthetic records and leaves its test database populated. Never point it at operational data. Native PostgreSQL tests remain blocked in the supplied container. Supply a separate empty TEST_RESTORE_DATABASE_URL as well; the runner refuses matching/populated targets.

## Production configuration

This is a development candidate; do not treat the successful build as a production approval.

1. Provision PostgreSQL and a private persistent file volume.
2. Copy `.env.example` to `.env`; replace its placeholders. Set a random 32+ character `SESSION_SECRET`, `ADMIN_EMAIL` and a private 12+ character `ADMIN_PASSWORD`. `.env` is ignored by Git and only read by the server. Do not use the synthetic demo for real documents.
3. Set `NODE_ENV=production` in the server environment **before migration/provisioning**. Run `npm run db:migrate`, then `npm run db:seed`. Provisioning creates only the first administrator and organization, without synthetic stock.
4. Run `npm run build`, then `npm start`. Production refuses a missing PostgreSQL URL or short session secret and disables demo sign-in.
5. Use a trusted HTTPS reverse proxy. Set `TRUST_PROXY=1` only for that deployment. Run `npm run worker` in a separate process with the same PostgreSQL configuration. Development embeds its worker in the API; never open one PGlite directory from multiple processes.
6. Approve real role permissions, handling rules, locations, customers, destinations and pack definitions before use.
7. Test native PostgreSQL concurrency, backup/restore, physical devices and private storage in staging.

## Backup and restore

Stop the app before using CLI backup with PGlite. Native PostgreSQL can snapshot while running, but use an operational maintenance window for consistent external files.

```sh
npm run backup
```

Creates a domain-record JSON backup and matching private-file directory with hash verification. Sessions are excluded. Restore into a fresh empty database only, with `ALLOW_RESTORE=true` and the absolute backup filename:

```sh
npm run restore -- /absolute/path/to/backup.json
```

See `docs/OPERATIONS.md`. The automated restore exercise passed on PGlite, including private-file bytes. Native PostgreSQL restore remains unverified.

## Known boundaries

- Manual entry is functional. OCR, automated barcode decoding, routing, notifications and printer integrations are unconfigured.
- Offline support consists of user-scoped IndexedDB drafts. No automatic background sync/outbox, cold-start offline authentication or server-confirmed offline dispatch is claimed.
- A manifest and responsive layouts are present; full service-worker offline shell/installability testing is deferred.
- Current operational lists are capped (usually 100–200 records), with stable API ordering. Large-warehouse search and full UI pagination need expansion before scale-up.
- Whole-box allocation and loose picking are supported. Start Picking, choose verified source contents, and physically transfer the selected quantity into a new or reusable order container. Compatible repeated picks reuse the same ID. Mixed-line receipt/confirmation preserves every line; outbound whole-container packing remains single product/batch for this candidate.
- Repeated/mixed return histories require supervised reconciliation; the disposition command handles one recorded shipment line per returned box.
- Role defaults are proposed code policy. Staff identity provisioning, custom permission-policy editing, product pack verification and tracking-mark version editing remain deployment/future workflows. Company memberships and warehouse grants are managed in Settings.
- Vehicle capacity, safe stacking, temperature compatibility and packing optimization are not inferred.

Project rules: `AGENTS.md`. Business facts: `PROJECT.md`. Candidate status: `STATE.md`. Module guide: `MAP.md`.

The original namespace is retained as an explicitly unconfirmed legacy warehouse. Administrators can create/review additional warehouses and assign access. Inter-warehouse transfers and replacement-order reconciliation after delivery custody require a later bounded workflow. Once delivery starts, additional goods use a new explicit internal order.


## Audit 002 usage
- Orders → **Pick loose quantities**: start Picking on the preparation board first. Choose verified source contents, quantity, new/existing picking container, and its confirmed location. The source remainder is retained. A fully used source is explicitly Empty.
- Products & batches → **Configure traceability**: enter actual per-product batch, expiry and measured-temperature requirements with their source. Empty limits remain unknown. Do not copy synthetic QA measurements into real product rules.
- Customers & destinations → **Verify / update address**: enter the verified address and evidence. Ordinary dispatch blocks unverified addresses. Supervisor exception requires its own checkbox and reason.
- Box details → **Review / confirm all contents**: preserve every line, batch and measured temperature. Corrections to verified quantities need appropriate permission and a reason.
- A new issue on checked goods removes readiness/loaded marks. Resolve it and physically recheck; the app never restores readiness automatically.

## Platform audit 001

Start with [evidence/PLATFORM-001.md](evidence/PLATFORM-001.md) and the concise [gap matrix](evidence/PLATFORM-GAP-MATRIX.md). The current automated suite has 58 checks: 57 pass on PGlite/HTTP and one native-backend check is explicitly skipped. This is not PostgreSQL concurrency proof.

- Settings → Company setup saves identity, locale and preparation weekday reviews independently, with version conflicts and immutable history. Configuration and onboarding guides: docs/CONFIGURATION.md and docs/ONBOARDING.md. Full operational onboarding is still incomplete.
- The preparation board supports explicit empty batches and suggests configured dates. It never creates/repeats customer orders. New batches snapshot policy; older batches remain legacy/unconfirmed.
- Company-aware database references prevent cross-company relationships. API reads remain company-scoped. PLATFORM-002 adds per-company membership roles, server-validated switching and warehouse grants; see docs/ACCESS.md.
- Recovery now refuses occupied DB/file targets and validates complete bundles. Use a nonexistent UPLOAD_DIR when restoring. Read docs/OPERATIONS.md and docs/MIGRATIONS.md before migration or restore.
- Existing pending device drafts are preserved through scoped fallback, and logout warns before clearing unsynced drafts. Automatic sync remains unimplemented.

The hosted Site, when linked, is a **device-local synthetic preview**, not this full authenticated backend. The ZIP contains the server application. Run locally with npm ci and npm run dev. See docs/READINESS.md for blocked and remaining gates.

## Platform access upgrade 002

Settings now supports company/warehouse selection and persisted administrator controls for existing staff memberships and warehouse grants. Operational data/files/jobs/exports are scoped by both company and warehouse. See docs/ACCESS.md for the exact boundary, compatibility grants and recovery. Inter-warehouse movement is deliberately blocked until an in-transit transfer workflow exists.

The current suite contains **71 checks: 70 pass, one native-only check is skipped**. Native PostgreSQL concurrency/restore remains unverified. New staff identities still require trusted provisioning; this screen sends no invitations or password emails. The previous PLATFORM-001 limits are superseded only where evidence/PLATFORM-002.md says so.

## Product catalogue CSV import · PLATFORM-003

Administrator: Products & batches → Open importer. Upload or paste UTF-8 CSV, explicitly map fields, review validation and commit the complete valid batch. Reload and reopen saved batches; retries do not duplicate products. Imports create company catalogue identities only, never stock/prices/conversions. Existing SKUs block create-only imports. Unknown handling and pack rules remain unconfirmed. See docs/IMPORTS.md and docs/ONBOARDING.md. Current verification: 84 tests, 83 passed, one native-only skipped; native PostgreSQL remains blocked. File-picker browser verification timed out; paste fallback and error download succeeded.
