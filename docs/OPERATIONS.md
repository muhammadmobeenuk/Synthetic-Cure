# Local run

Node 22.12+; npm ci; npm run dev. In development without DATABASE_URL persistent PGlite at runtime/database; synthetic demo entry is enabled. Set DEMO_MODE=false to disable. Port 3000 default.

# PostgreSQL production

Provision PostgreSQL 15+, private persistent upload volume, TLS reverse proxy. Export DATABASE_URL, SESSION_SECRET (random 32+ chars), ADMIN_EMAIL, ADMIN_PASSWORD (12+ chars), NODE_ENV=production. npm run db:migrate; npm run db:seed; npm run build; npm start. Demo authentication disabled in production. Do not copy runtime sessions into production. Configure trust proxy deliberately; terminate HTTPS and set TRUST_PROXY=1 only behind a trusted proxy.

# Recovery

npm run backup writes runtime/backups timestamped JSON of domain records; private uploads copied alongside archive. Stop writes before restore. npm run restore -- /absolute/backup.json requires ALLOW_RESTORE=true and rejects nonempty targets unless explicitly cleared outside this tool. PostgreSQL operators should additionally use pg_dump/pg_restore for complete physical operations. Sessions are intentionally excluded. Before production, exercise native PostgreSQL restore in staging and verify hashes/private file retrieval.

# Health

/api/health liveness; /api/ready database query. Request IDs on all responses. No request bodies/passwords logged. npm run worker processes queued exports with bounded retries. Worker state visible via /api/v1/jobs.

# Boundaries

OCR, barcode decoding, printers, maps and notification providers unconfigured. Photo capture uses browser file/camera chooser; torch/zoom not supported by this candidate. No inferred safe arrangement. Review limitations in STATE.md before deployment.

CLI migrate/seed/backup/restore also read a server-only .env when present; exported environment values take precedence. Production startup sets NODE_ENV via a portable TypeScript entrypoint. Standard tests force an isolated in-memory test database unless TEST_DATABASE_URL is explicitly supplied. Never supply an operational URL as TEST_DATABASE_URL.

## PLATFORM-001 recovery hardening

`npm run backup -- /absolute/new-backup.json` uses a REPEATABLE READ, read-only database snapshot on native PostgreSQL. Private objects are immutable identifiers; every referenced file is size/hash checked and written into a private `.files` bundle before the exclusive JSON manifest. Existing backup names are never overwritten. Use a maintenance window for database/file recovery; this is a logical domain backup, not a replacement for managed PostgreSQL PITR/schema/role backups.

Restore requires an empty migrated database and a **nonexistent** target private-file directory. The CLI accepts `UPLOAD_DIR=/absolute/new-private` for a fresh file target. It validates the complete manifest and referenced file bytes, stages them privately, locks/checks native tables, imports inside one transaction, then copies to an exclusively created file directory. Any handled failure rolls back the DB and removes only the new directory created by this attempt. It never overwrites an existing file store. Legacy v1 archives remain accepted; missing new company configuration is restored as unconfirmed identity-only settings.

A process/power loss between file creation and DB commit can leave an orphan new target directory. Keep the application stopped, inspect the DB and target, quarantine that uncommitted target under a new name, and retry from the original verified backup with a fresh target. There is no distributed filesystem/DB atomicity or automatic crash cleanup claim. Never delete an ambiguous target automatically.

Before switching a restored installation live: compare domain/event counts, retrieve authorized private documents, verify hashes, test unauthorized retrieval, confirm configuration versions/preparation snapshots and run a receipt/move/search workflow. Sessions are excluded; staff must authenticate again. Native restore is still blocked in the supplied environment.

Source/restore PostgreSQL tests require two different empty disposable databases. Test code refuses populated schemas and uses independent connections for move/allocation races. Do not use operational URLs.

Worker export commands recheck job kind, current active company actor and export permission. Failed jobs use bounded retries and retain visible failure. Export downloads and workspace job results require export permission. Unknown provider jobs cannot execute arbitrary adapters.

## Membership and warehouse operation

See ACCESS.md. Sessions store selected company/warehouse but permissions always come from current membership/grant rows. Background exports revalidate active role and warehouse grant; previously queued jobs may fail after revocation. Review failed jobs rather than rerunning with elevated ownership.

Logical backups now use jadesun-v3, include exact membership/grant/warehouse rows, and preserve audit scopes. v1/v2 restore remains supported without inventing additional companies/warehouses. Rehearse DB-plus-private-file recovery after enabling multiple warehouses. Native locks and session isolation remain gated on PostgreSQL evidence.

Product import recovery: reopen the scoped batch in Products & batches → Open importer; refresh validation before commit. A response failure is retried with the same operation ID. Conflicts retain original source; correct explicitly and review a new batch. Saved originals are backed up in v4 with product links; preserve alongside all private files using the existing consistent bundle. No automatic import reversal/deletion. Native PostgreSQL migration/restore/concurrency proof remains required.

## Review-only document recognition

See [AI-RECOGNITION.md](AI-RECOGNITION.md) for Tesseract language packages, server-only Gemini configuration, consent, worker setup, privacy and recovery. JPEG/PNG/WebP only. Provider output remains unreviewed and cannot alter stock. No live provider verification has been completed. The earlier statement that OCR is unconfigured describes the previous candidate; availability now depends on worker configuration.
