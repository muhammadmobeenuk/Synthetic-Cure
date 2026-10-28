# API contracts

/api/v1. Session context owns actor/organization/role. CSRF token required on mutations. Request IDs on responses. See packages/contracts/index.ts for executable input contracts. Output records carry version, ISO timestamps, decimal quantity strings and explicit units. Errors {error:{code,message,details},requestId}; stale 409 details include current record. Pagination uses stable created_at,id ordering with capped limit and offset.
Commands include clientOperationId UUID and expectedVersion where record state changes. Identical replays return original response; payload mismatch 409. Receipt returns physical box. Photos uploaded separately so failure preserves a box and retryable file. Authorization before idempotency response. No client ownership accepted.

Additional commands: POST /orders/:id/amend, /orders/:id/unallocate, /preparation-batches/:id/add-orders, /preparation-batches/:id/remove-order, /preparation-batches/:id/carry, /destination-authorizations, /counts, /returns/:id/disposition, /boxes/:id/condition, /trips/:id/reassign, /jobs. Dispatch accepts optional partialApproved + reason; server permission is required and unloaded lines move to a new shipment. GET /workspace is an initial bounded paginated operational snapshot, not an unlimited warehouse export.

Audit 002: `POST /orders/:id/pick-loose` includes order expectedVersion, sourceVersion, optional targetVersion, source contents ID, product-base quantity, picking-container location and physical-confirmation reason. Optional target box reuses a compatible already-picked container. `POST /products/:id/traceability` configures confirmed per-product requirements. `POST /destinations/:id/verify-address` records a verified address with reason/version. Dispatch accepts `addressOverride` and `addressOverrideReason`; server permissions apply independently of UI controls. Confirm-label quantity corrections require authorization/reason and snapshot previous contents. A duplicate load response carries `duplicate: true` and does not append another business event.

## Company settings
POST /api/v1/company-configuration: administrator configure permission, clientOperationId, expectedVersion, section(identity|locale|schedule), reason and only section-specific fields. Identity: displayName, optional-null operatingProfile. Locale: valid timezone, language(en|zh), dateFormat(day-first|iso). Schedule: preparationWeekdays unique integers 0–6, Sunday=0, []=ad-hoc. Actor/company are authenticated, never client-owned. Identical replay returns the original result; stale version is structured 409 with current authorized settings. GET /company-configuration/history requires configure permission. Workspace includes current company configuration. Preparation accepts explicit orderIds=[] and snapshots configuration without creating orders.

## Access/context commands

GET /session returns safe identity, server-resolved user with org_id/role/warehouse_id/home_org_id, own active company choices and permitted warehouse choices. POST /auth/context accepts companyId and optional warehouseId, verifies both, audits selection, rotates session/CSRF. No active membership retains signed-in identity only for context recovery/logout. No warehouse grant permits only setup/context endpoints.

GET /access/directory requires manage_access (administrator). POST /access/memberships accepts email, expectedVersion≥0, role, active, reason, clientOperationId. POST /warehouses accepts code/name/address-null/reason/operation ID; creator receives an audited initial grant. POST /warehouses/:id/review accepts expectedVersion/name/address-null/reason/operation ID. POST /access/warehouse-grants accepts userId/warehouseId/expectedVersion≥0/active/reason/operation ID. All company scope is server derived.

Current browser clients send X-Company-Context and X-Warehouse-Context as stale-tab preconditions. A mismatch returns 409 CONTEXT_CHANGED before business commands. Revoked membership/warehouse access returns 401/403 without a cached command result. Reused operation IDs from another warehouse context return structured 409 OPERATION_SCOPE. These headers do not grant access.

Product CSV preview/read/list/commit/error-report contracts and recovery: [IMPORTS.md](IMPORTS.md). Imports require configure permission and an assigned warehouse; company/warehouse fields are server-derived.

Customer order creation accepts up to 100 distinct product lines in verified base units. Duplicate product IDs are rejected for new orders; changing historical duplicate lines requires reconciliation. Client retry must retain the same operation ID and payload. See evidence/CUSTOMER-ORDER-001.md.

Pallet groups: GET /api/v1/pallet-groups requires dispatch permission and warehouse scope. POST /api/v1/pallet-groups accepts clientOperationId, tripId, name, reason. POST /api/v1/pallet-groups/:id/add or /remove accepts clientOperationId, expectedVersion, palletId, reason. Server derives organization, warehouse and actor; trip must be planned and pallet in same warehouse. Operations are idempotent and versioned; duplicate membership returns 409. Planning does not allocate shipments or move stock.

GET /api/v1/pallet-groups/:id/reconciliation requires dispatch permission and the active warehouse. It returns up to 200 distinct current physical boxes, pallet revision and deduplicated active shipment assignments with order, customer, destination, trip and whether all shipment lines for that box were loaded. Pass the returned `nextCursor` as `cursor` for the next page; null indicates the last page. The opaque cursor is bound to the group and membership version. Invalid cursors return 400; a changed group version returns 409 and the review must be restarted. Results are ordered by stable box ID. `truncated` indicates more boxes exist. States are `no_shipment`, `trip_unassigned`, `same_trip`, `different_trip`, or `multiple_shipments`. A matching trip is not load verification or permission to dispatch. The result may become stale immediately and can change between pages as boxes move; restart the review and use the authoritative shipment/pallet commands. Canceled shipments are excluded. No stock or manifest is changed.

## Worker sheet and text recognition

`GET /api/v1/orders/:id/worker-sheet` requires prepare access and current warehouse scope; returns escaped, restrictive-CSP printable HTML from a consistent read. `GET /api/v1/ai/status` reports availability without secrets. `POST /api/v1/documents/:id/extract` requires receive access and `{clientOperationId, provider: 'local'|'gemini', confirmExternalTransfer}`; Gemini requires explicit true. Identical replay returns the same job; a changed payload with the same key is rejected. `GET /api/v1/extractions/:id` requires scoped receive access and returns job state plus unreviewed plain text only when complete. Neither command changes stock.

## Expected inbound (one product per expectation)

`GET /api/v1/inbound` requires receive permission and active warehouse; returns up to 200 company suppliers and the latest 200 warehouse expectations. Quantities for accepted, held and pending are classifications at receipt, not current dispositions. Outstanding equals expected less all quantities received, including held/pending. `POST /suppliers` requires configure permission and `{clientOperationId,code,name}`. `POST /expected-receipts` requires receive permission and `{clientOperationId,supplierId,productId,reference,expectedDate,quantity,unit}`, where unit must match the product's base unit. Planning creates no stock. `POST /expected-receipts/:id/receive` requires receive permission and `{clientOperationId,expectedVersion,locationId,quantity,condition,sourceLabel}`; it locks the expectation, blocks over-receipt, creates one physical box through the existing receipt service, records its original classification and audit event, and returns its authoritative version. Identical retries return the original result. There is no silent stock conversion, accepted status from a pending traceability check, or automatic supplier-return workflow. Over-delivery, cancellation, edits and multi-product purchase orders require future explicit workflows. Supplier and expectation reference data are not assumed to be real.

`POST /api/v1/expected-receipts/:id/cancel` requires adjust permission and `{clientOperationId,expectedVersion,reason}`. It locks the expectation, cancels only its unreceived balance, appends one immutable event with reason and quantity, and increments the version. The same operation replay returns its original result; a stale, completed, already canceled or unauthorized command is rejected. Previously received boxes and their physical stock/holds are untouched. Further receipts against the canceled expectation are blocked. The inbound list shows canceled balance and reason separately from outstanding. Cancellation is not a supplier return.

## P2 Traceability, Quality Quarantine Holds, Recalls & Scoped Offline Sync

- `POST /api/v1/quality-holds`: Requires supervisor or administrator role and `{clientOperationId, scope: 'box'|'product'|'lot'|'location', targetId, reason, severity: 'minor'|'major'|'critical'}`. Atomically places matching stock into quarantine condition ('hold'); strictly blocks allocation, picking verification, and vehicle loading.
- `POST /api/v1/quality-holds/:id/release`: Requires supervisor or administrator role and `{clientOperationId, expectedVersion, releaseReason}`. Optimistic concurrency check; releases hold, restores stock condition to confirmed good, records immutable audit event.
- `GET /api/v1/quality-holds`: Returns scoped active and released quality holds.
- `POST /api/v1/recalls`: Requires supervisor or administrator role and `{clientOperationId, code, title, productId, lotId?, reason, severity: 'class_1'|'class_2'|'class_3'}`. Atomically transitions on-hand inventory to quarantine hold and maps forward outbound impact across shipments, orders, and customer destinations.
- `GET /api/v1/recalls`: Returns scoped list of product safety recalls.
- `GET /api/v1/recalls/:id`: Returns comprehensive recall dossier including totals, quarantined on-hand inventory locations, and outbound distribution.
- `GET /api/v1/recalls/:id/export`: Exports recall dossier as sanitized CSV with spreadsheet formula injection neutralization (`=`, `+`, `-`, `@`, `\t`, `\r` prefixed with `'`).
- `POST /api/v1/recalls/:id/close`: Requires supervisor or administrator role and `{clientOperationId, expectedVersion, closureNotes}`.
- `GET /api/v1/traceability/backward`: Requires review permission; query parameter `boxId`, `boxCode`, or `orderId`. Returns backward trace from physical customer box to inbound PO expectation, supplier name, lot reference, and temperature measurements.
- `GET /api/v1/traceability/forward`: Requires review permission; query parameter `lotId`, `lotReference`, or `serialNumber`. Returns forward dispersion across on-hand boxes and outbound customer deliveries.
- `POST /api/v1/serials`: `{clientOperationId, productId, serialNumber, lotId?, boxId?, locationId?}`. Enforces uniqueness across product and organization; records initial received state.
- `POST /api/v1/sync/queue`: Queues offline command mutations with `{clientOperationId, commandName, targetEntity, targetId?, payload, dependsOnOperationId?, fileAttachments?}`. Enforces file-before-command dependency order.
- `GET /api/v1/sync/outbox`: Returns user/company/warehouse scoped offline outbox mutations.
- `POST /api/v1/sync/resolve-conflict`: `{queueId, action: 'retry'|'rebase'|'discard', rebaseExpectedVersion?}`. Resolves visible 409 conflict. Bounded retries (maximum 5).

## P3 Client Portal, Webhooks/Notifications & Carrier/Accounting Adapters

- `GET /api/v1/portal/me`: Returns client portal authorization context (`customerId`, `stockOwnerId`, `customerName`, `stockOwnerName`). Returns 403 `PORTAL_ACCESS_DENIED` if user is not linked to a customer or stock owner.
- `POST /api/v1/portal/link-user`: Requires administrator permission. Body: `{clientOperationId, userId, customerId?, stockOwnerId?}`. Links a user account to a customer or stock owner entity.
- `GET /api/v1/portal/inventory`: Returns real-time authoritative inventory balances for the linked stock owner or customer's dedicated stock. Isolated from other customers/owners.
- `GET /api/v1/portal/orders`: Returns customer order history for the authenticated client's customer identity.
- `POST /api/v1/portal/orders`: Body: `{clientOperationId, destinationId, lines: [{productId, quantity}], notes?}`. Submits a draft customer order. Atomically validates authorized destinations and positive quantities.
- `GET /api/v1/portal/shipments`: Returns outbound shipments, vehicles, stops, and delivery note details for the client's orders.
- `GET /api/v1/notifications/endpoints`: Requires configure permission. Returns registered webhook endpoints for the current organization.
- `POST /api/v1/notifications/endpoints`: Requires configure permission. Body: `{clientOperationId, url, topics, secret, active?}`. Registers a new webhook subscription.
- `POST /api/v1/notifications/endpoints/:id`: Requires configure permission. Body: `{clientOperationId, expectedVersion, url?, topics?, secret?, active?}`. Updates webhook subscription.
- `POST /api/v1/notifications/test`: Requires configure permission. Body: `{endpointId}`. Dispatches an immediate test ping event (`test.ping`) signed with HMAC-SHA256 (`X-Synthetic-Signature`).
- `GET /api/v1/notifications/deliveries`: Requires configure permission. Returns delivery audit log with response status, error messages, and retry attempts.
- `POST /api/v1/adapters/carrier/manifest`: Requires dispatch permission. Body: `{clientOperationId, tripId, carrierName, serviceLevel, trackingNumber?, notes?}`. Books a carrier manifest.
- `GET /api/v1/adapters/carrier/manifest/:tripId`: Returns structured carrier manifest with vehicle details, pallets, boxes, and destination stops. Query param `format=csv` exports a standardized CSV manifest.
- `GET /api/v1/adapters/accounting/export`: Requires configure permission. Query params: `startDate`, `endDate`, `format` (`json` | `csv`). Returns accounting ledger and billed transactions with formula-injection neutralization (`=`, `+`, `-`, `@`) and explicit unverified pricing notices.

## P3 PowerPoint Operations Reports & Shift Briefings

- `GET /api/v1/reports/operations/data`: Requires supervisor or administrator role. Query params: `startDate` (ISO string, optional), `endDate` (ISO string, optional), `warehouseId` (string, optional). Returns authoritative JSON metrics:
  - `inbound`: `purchaseOrdersCount`, `totalExpectedUnits`, `receivedBoxesCount`, `discrepanciesCount`, `discrepancyBreakdown: { damaged, short, over, unexpected }`.
  - `picking`: `totalPicksVerified`, `totalUnitsPicked`, `shortagePicksCount`, `substitutionsCount`, `totesDispatchedCount`.
  - `inventory`: `totalOnHandQuantity`, `totalReservedQuantity`, `totalAvailableQuantity`, `totalHeldQuantity`, `stockOwners: [{ ownerId, ownerName, onHand, available, held }]`.
  - `quality`: `activeHoldsCount`, `criticalHoldsCount`, `quarantinedBoxesCount`, `recentHolds: [{ id, boxId, reason, notes, createdAt }]`.
  - `tasks`: `openTasksCount`, `claimedTasksCount`, `blockedTasksCount`, `tasksByType: { putaway, replenishment, picking, packing, cycle_count }`.
- `GET /api/v1/reports/operations/pptx`: Requires supervisor or administrator role. Query params: `startDate`, `endDate`, `warehouseId`. Generates and streams an Open Packaging Conventions (OPC) PresentationML binary archive (.pptx) with headers:
  - `Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation`
  - `Content-Disposition: attachment; filename="synthetic-cure-operations-report-<timestamp>.pptx"`
  - Slide 1: Executive Title & Operational Briefing Context (Company, Warehouse, Timestamp, Floor Notice)
  - Slide 2: Inbound Dock Intake & Supplier Receipts Breakdown
  - Slide 3: Picking Floor Throughput & Shift Velocity
  - Slide 4: Stock-Owner Inventory Distribution & Integrity
  - Slide 5: Quality Quarantine Holds & Safety Metrics
  - Slide 6: Shift Handover Action Items & Open Floor Exceptions


