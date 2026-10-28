-- 017_daily_work_orders_transport.sql
-- P1 Daily work, orders, picking exceptions, packing, transport custody & scheduling

-- 1. Extend warehouse_tasks
ALTER TABLE warehouse_tasks DROP CONSTRAINT IF EXISTS warehouse_tasks_kind_check;
ALTER TABLE warehouse_tasks ADD CONSTRAINT warehouse_tasks_kind_check CHECK(kind IN ('putaway','replenishment','picking','packing','cycle_count'));

ALTER TABLE warehouse_tasks DROP CONSTRAINT IF EXISTS warehouse_tasks_status_check;
ALTER TABLE warehouse_tasks ADD CONSTRAINT warehouse_tasks_status_check CHECK(status IN ('pending','claimed','assigned','in_progress','blocked','completed','cancelled'));

ALTER TABLE warehouse_tasks ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE warehouse_tasks ADD COLUMN IF NOT EXISTS blocked_reason text;
ALTER TABLE warehouse_tasks ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE warehouse_tasks ADD COLUMN IF NOT EXISTS claimed_by text REFERENCES users(id);
ALTER TABLE warehouse_tasks ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE warehouse_tasks ADD COLUMN IF NOT EXISTS execution_reference_id text;

-- 2. Shift Handovers
CREATE TABLE IF NOT EXISTS shift_handovers (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  outgoing_user_id text NOT NULL REFERENCES users(id),
  incoming_user_id text REFERENCES users(id),
  shift_name text NOT NULL CHECK(length(shift_name) BETWEEN 1 AND 100),
  handover_date date NOT NULL,
  notes text NOT NULL CHECK(length(notes) BETWEEN 3 AND 4000),
  pending_tasks jsonb NOT NULL DEFAULT '[]',
  blocked_tasks jsonb NOT NULL DEFAULT '[]',
  acknowledged_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id)
);

-- 3. Picking Totes
CREATE TABLE IF NOT EXISTS picking_totes (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  code text NOT NULL CHECK(length(code) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','in_use','held','retired')),
  current_order_id text REFERENCES orders(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, warehouse_id, code),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id)
);

-- 4. Picking Exceptions and Verifications
CREATE TABLE IF NOT EXISTS picking_verifications (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  order_id text NOT NULL REFERENCES orders(id),
  order_line_id text NOT NULL REFERENCES order_lines(id),
  allocation_id text REFERENCES allocations(id),
  tote_id text REFERENCES picking_totes(id),
  source_location_id text NOT NULL REFERENCES locations(id),
  product_id text NOT NULL REFERENCES products(id),
  lot_id text,
  quantity_requested numeric(18,6) NOT NULL CHECK(quantity_requested > 0),
  quantity_picked numeric(18,6) NOT NULL CHECK(quantity_picked >= 0),
  shortage_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK(shortage_quantity >= 0),
  is_substitution boolean NOT NULL DEFAULT false,
  substituted_product_id text REFERENCES products(id),
  substitution_reason text,
  authorized_by text REFERENCES users(id),
  status text NOT NULL CHECK(status IN ('verified','shortage','substituted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id)
);

-- 5. Order Backorders
CREATE TABLE IF NOT EXISTS order_backorders (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  order_id text NOT NULL REFERENCES orders(id),
  order_line_id text NOT NULL REFERENCES order_lines(id),
  product_id text NOT NULL REFERENCES products(id),
  requested_quantity numeric(18,6) NOT NULL CHECK(requested_quantity > 0),
  fulfilled_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK(fulfilled_quantity >= 0),
  backorder_quantity numeric(18,6) NOT NULL CHECK(backorder_quantity > 0),
  unit text NOT NULL CHECK(length(unit) BETWEEN 1 AND 30),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reconciled','cancelled')),
  reason text,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id)
);

-- 6. Driver Reassignments
CREATE TABLE IF NOT EXISTS driver_reassignments (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  trip_id text NOT NULL REFERENCES trips(id),
  previous_driver_id text REFERENCES users(id),
  new_driver_id text NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  actor_id text NOT NULL REFERENCES users(id),
  reassigned_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id)
);

-- 7. Shipment Recipient Details
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS recipient_type text DEFAULT 'final_recipient' CHECK(recipient_type IN ('final_recipient','intermediary'));
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS recipient_name text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS recipient_signature text;
