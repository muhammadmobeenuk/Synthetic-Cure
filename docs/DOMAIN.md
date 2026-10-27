# Invariants

Organization scope on every reference. Stable unique internal box IDs distinct from customer/product codes. One pallet FK per box. Effective location inherited from pallet. Removing membership affects one box only. Totals group quantities by product/unit; null never becomes zero. No conversion without a verified product definition. Server rejects over-allocation and stale expectedVersion. Idempotency keys scoped to organization/command; canonical payload hash rejects changed replay. Transactions append business events. History is immutable; adjustments append reasons.
Preparation progresses Orders selected → Picking → Packing → Checking → Ready. Verified manifest revision invalidated by membership/content changes. Order edits invalidate checking. Ready never dispatches. Dispatch requires loaded permitted boxes. Handover records separate delivered and returned quantities. Returns held pending disposition.

Whole-box allocation is protected by a unique database index on allocations.box_id. Moving Picking → Packing records picked_quantity for the currently allocated boxes. Amendments reset checking and loaded flags; reducing below allocated demand first requires explicit unallocation. Cross-customer destination use requires an explicit authorization row. Partial dispatch moves unloaded shipment lines into a new unassigned remaining shipment in the same transaction. A returned box is held; authorized inspection snapshots only recorded returned quantity back into warehouse contents and appends a disposition event.

Loose picking conserves recorded source + target quantity, product, batch and unit. The source is never the outgoing shipment unit for a partial pick. A fully depleted source is explicitly `empty`, with no unknown-quantity contents placeholder. Existing target stock must already be fully reserved and picked for this order; unallocated contents cannot be silently included. Product-rule changes invalidate affected checks. Readiness and dispatch eligibility are validated separately at the time of each command. Driver object authorization precedes stale-state disclosure and cached response replay.

## Configuration and preservation
Company configuration has typed identity/locale/profile/weekday fields, reviewed flags and a monotonically increasing version. Consequential preparation snapshots retain the version and scheduling policy at creation; legacy preparations remain null/unconfirmed. Schedule templates only suggest dates and never generate customer orders. Stock owner remains unmodelled rather than being inferred from ordering customer. Native quantity-tracked inventory/balance-ledger work is a separate migration, not an alias for boxes.

## Membership/warehouse dimensions

Home-company identity is provenance, distinct from active membership role. Membership/grant records are versioned and soft-revoked to retain historic actor links. Existing single namespaces are explicitly legacy/unconfirmed. Operational warehouse identity is constrained independently of company; owner/customer/recipient are still separate concepts and stock ownership is not inferred. Cross-warehouse ordinary moves are forbidden until the transfer domain is implemented.

## Product import provenance
Import batches own immutable original CSV, explicit column mapping, source/identity hashes and policy version 1. Typed links connect source lines to created company product identities. Warehouse is review provenance/access scope; imports never create stock, batches, prices or conversions. See IMPORTS.md.

Logical pallet groups are planning records linked to a trip. Each member is a separate pallet with its own physical location and contents. A pallet has at most one active group. Group changes neither move stock nor check/load/dispatch a shipment. Current pallet manifest state is read live; shipment/stop allocation remains separate and authoritative. See evidence/PALLET-GROUP-001.md.
