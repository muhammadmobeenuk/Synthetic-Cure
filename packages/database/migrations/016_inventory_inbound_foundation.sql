-- P1 Inventory and Inbound Foundation
-- 1. Stock Ownership
CREATE TABLE IF NOT EXISTS stock_owners (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  code text NOT NULL CHECK(length(code) BETWEEN 1 AND 120),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, org_id),
  UNIQUE(org_id, code)
);

INSERT INTO stock_owners(id, org_id, code, name)
SELECT id||':default_owner', id, 'DEFAULT', 'Primary Owner · '||name
FROM organizations
ON CONFLICT DO NOTHING;

ALTER TABLE boxes ADD COLUMN IF NOT EXISTS owner_id text;
UPDATE boxes SET owner_id = org_id||':default_owner' WHERE owner_id IS NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boxes_owner_fk') THEN
    ALTER TABLE boxes ADD CONSTRAINT boxes_owner_fk FOREIGN KEY(owner_id, org_id) REFERENCES stock_owners(id, org_id);
  END IF;
END $$;

-- 2. Variable weight and catch weight on contents
ALTER TABLE contents ADD COLUMN IF NOT EXISTS catch_weight numeric(18,6) CHECK(catch_weight IS NULL OR catch_weight > 0);
ALTER TABLE contents ADD COLUMN IF NOT EXISTS package_count integer CHECK(package_count IS NULL OR package_count > 0);

-- 3. Verified Product Unit Conversions
CREATE TABLE IF NOT EXISTS product_unit_conversions (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  product_id text NOT NULL,
  from_unit text NOT NULL CHECK(length(from_unit) BETWEEN 1 AND 30),
  to_unit text NOT NULL CHECK(length(to_unit) BETWEEN 1 AND 30),
  factor numeric(18,6) NOT NULL CHECK(factor > 0),
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, org_id),
  UNIQUE(org_id, product_id, from_unit, to_unit),
  FOREIGN KEY(product_id, org_id) REFERENCES products(id, org_id)
);

-- 4. Unified Inventory Balances and Ledger
CREATE TABLE IF NOT EXISTS inventory_balances (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  product_id text NOT NULL,
  location_id text NOT NULL,
  owner_id text NOT NULL,
  unit text NOT NULL CHECK(length(unit) BETWEEN 1 AND 30),
  on_hand numeric(18,6) NOT NULL DEFAULT 0 CHECK(on_hand >= 0),
  reserved numeric(18,6) NOT NULL DEFAULT 0 CHECK(reserved >= 0),
  available numeric(18,6) NOT NULL DEFAULT 0 CHECK(available >= 0),
  picked numeric(18,6) NOT NULL DEFAULT 0 CHECK(picked >= 0),
  in_transit numeric(18,6) NOT NULL DEFAULT 0 CHECK(in_transit >= 0),
  held numeric(18,6) NOT NULL DEFAULT 0 CHECK(held >= 0),
  dispatched numeric(18,6) NOT NULL DEFAULT 0 CHECK(dispatched >= 0),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, org_id, warehouse_id),
  UNIQUE(org_id, warehouse_id, product_id, location_id, owner_id, unit),
  CHECK(available = on_hand - reserved - picked - held),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id),
  FOREIGN KEY(location_id, warehouse_id) REFERENCES locations(id, warehouse_id),
  FOREIGN KEY(product_id, org_id) REFERENCES products(id, org_id),
  FOREIGN KEY(owner_id, org_id) REFERENCES stock_owners(id, org_id)
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  product_id text NOT NULL,
  location_id text NOT NULL,
  owner_id text NOT NULL,
  box_id text,
  quantity_delta numeric(18,6) NOT NULL,
  unit text NOT NULL CHECK(length(unit) BETWEEN 1 AND 30),
  state text NOT NULL CHECK(state IN ('on_hand','reserved','available','picked','in_transit','held','dispatched')),
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  notes text,
  actor_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id),
  FOREIGN KEY(location_id, warehouse_id) REFERENCES locations(id, warehouse_id),
  FOREIGN KEY(product_id, org_id) REFERENCES products(id, org_id),
  FOREIGN KEY(owner_id, org_id) REFERENCES stock_owners(id, org_id)
);

CREATE TRIGGER immutable_inventory_ledger BEFORE UPDATE OR DELETE ON inventory_ledger FOR EACH ROW EXECUTE FUNCTION protect_business_events();

-- 5. Multi-line Purchase Orders and Lines
CREATE TABLE IF NOT EXISTS purchase_orders (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  supplier_id text NOT NULL,
  po_number text NOT NULL CHECK(length(po_number) BETWEEN 1 AND 120),
  supplier_reference text NOT NULL CHECK(length(supplier_reference) BETWEEN 1 AND 200),
  expected_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','partially_received','received','cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, org_id, warehouse_id),
  UNIQUE(org_id, warehouse_id, po_number),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id),
  FOREIGN KEY(supplier_id, org_id) REFERENCES suppliers(id, org_id)
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  purchase_order_id text NOT NULL,
  line_number integer NOT NULL CHECK(line_number > 0),
  product_id text NOT NULL,
  expected_quantity numeric(18,6) NOT NULL CHECK(expected_quantity > 0),
  unit text NOT NULL CHECK(length(unit) BETWEEN 1 AND 30),
  received_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK(received_quantity >= 0),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','partially_received','received','cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id, org_id, warehouse_id),
  UNIQUE(purchase_order_id, line_number),
  FOREIGN KEY(purchase_order_id, org_id, warehouse_id) REFERENCES purchase_orders(id, org_id, warehouse_id),
  FOREIGN KEY(product_id, org_id) REFERENCES products(id, org_id)
);

-- 6. Inbound Discrepancies
CREATE TABLE IF NOT EXISTS inbound_discrepancies (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  purchase_order_id text,
  po_line_id text,
  expected_receipt_id text,
  product_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('unexpected','over','short','damaged')),
  reported_quantity numeric(18,6) NOT NULL CHECK(reported_quantity > 0),
  unit text NOT NULL CHECK(length(unit) BETWEEN 1 AND 30),
  evidence text NOT NULL CHECK(length(evidence) >= 3),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  disposition text CHECK(disposition IS NULL OR disposition IN ('accept_hold','reject_return','adjust_po')),
  reviewed_by text REFERENCES users(id),
  reviewed_at timestamptz,
  review_notes text,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id),
  FOREIGN KEY(product_id, org_id) REFERENCES products(id, org_id)
);

-- 7. Supplier Returns
CREATE TABLE IF NOT EXISTS supplier_returns (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  supplier_id text NOT NULL,
  discrepancy_id text REFERENCES inbound_discrepancies(id),
  product_id text NOT NULL,
  box_id text,
  quantity numeric(18,6) NOT NULL CHECK(quantity > 0),
  unit text NOT NULL CHECK(length(unit) BETWEEN 1 AND 30),
  reason text NOT NULL CHECK(length(reason) >= 3),
  status text NOT NULL DEFAULT 'held' CHECK(status IN ('held','authorized','dispatched','reconciled')),
  authorized_by text REFERENCES users(id),
  authorized_at timestamptz,
  outbound_tracking text,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id),
  FOREIGN KEY(supplier_id, org_id) REFERENCES suppliers(id, org_id),
  FOREIGN KEY(product_id, org_id) REFERENCES products(id, org_id)
);

-- 8. Warehouse Tasks (Putaway & Replenishment)
CREATE TABLE IF NOT EXISTS warehouse_tasks (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('putaway','replenishment')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','assigned','in_progress','completed','cancelled')),
  priority integer NOT NULL DEFAULT 1,
  product_id text REFERENCES products(id),
  box_id text,
  source_location_id text NOT NULL,
  destination_location_id text NOT NULL,
  quantity numeric(18,6) CHECK(quantity IS NULL OR quantity > 0),
  unit text,
  assigned_user_id text REFERENCES users(id),
  scan_confirmation text,
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id),
  FOREIGN KEY(source_location_id, warehouse_id) REFERENCES locations(id, warehouse_id),
  FOREIGN KEY(destination_location_id, warehouse_id) REFERENCES locations(id, warehouse_id)
);

-- 9. Picking Location Replenishment Policy
CREATE TABLE IF NOT EXISTS location_replenishment_policies (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  location_id text NOT NULL,
  product_id text NOT NULL,
  min_quantity numeric(18,6) NOT NULL CHECK(min_quantity >= 0),
  target_quantity numeric(18,6) NOT NULL CHECK(target_quantity > min_quantity),
  unit text NOT NULL CHECK(length(unit) BETWEEN 1 AND 30),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(warehouse_id, location_id, product_id),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id),
  FOREIGN KEY(location_id, warehouse_id) REFERENCES locations(id, warehouse_id),
  FOREIGN KEY(product_id, org_id) REFERENCES products(id, org_id)
);

-- 10. Inter-Warehouse Transfers
CREATE TABLE IF NOT EXISTS transfer_orders (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  order_number text NOT NULL CHECK(length(order_number) BETWEEN 1 AND 120),
  source_warehouse_id text NOT NULL,
  destination_warehouse_id text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','dispatched','partially_received','received','cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(source_warehouse_id <> destination_warehouse_id),
  UNIQUE(org_id, order_number),
  FOREIGN KEY(source_warehouse_id, org_id) REFERENCES warehouses(id, org_id),
  FOREIGN KEY(destination_warehouse_id, org_id) REFERENCES warehouses(id, org_id)
);

CREATE TABLE IF NOT EXISTS transfer_lines (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  transfer_order_id text NOT NULL REFERENCES transfer_orders(id),
  line_number integer NOT NULL CHECK(line_number > 0),
  product_id text NOT NULL,
  box_id text,
  requested_quantity numeric(18,6) NOT NULL CHECK(requested_quantity > 0),
  dispatched_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK(dispatched_quantity >= 0),
  received_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK(received_quantity >= 0),
  damaged_quantity numeric(18,6) NOT NULL DEFAULT 0 CHECK(damaged_quantity >= 0),
  unit text NOT NULL CHECK(length(unit) BETWEEN 1 AND 30),
  status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','dispatched','partially_received','received','cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(transfer_order_id, line_number),
  FOREIGN KEY(product_id, org_id) REFERENCES products(id, org_id)
);

-- 11. Multi-Entity CSV Imports
CREATE TABLE IF NOT EXISTS csv_imports (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  entity_type text NOT NULL CHECK(entity_type IN ('customers','suppliers','locations','orders','expected_receipts','opening_stock')),
  source_filename text NOT NULL,
  source_hash text NOT NULL,
  row_count integer NOT NULL,
  valid_count integer NOT NULL,
  error_count integer NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','committed','rejected')),
  raw_content text NOT NULL,
  mapping jsonb NOT NULL,
  cut_over_date date,
  reconciliation_notes text,
  created_by text NOT NULL REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id)
);

CREATE TABLE IF NOT EXISTS csv_import_errors (
  id text PRIMARY KEY,
  import_id text NOT NULL REFERENCES csv_imports(id),
  row_number integer NOT NULL,
  field text NOT NULL,
  message text NOT NULL,
  raw_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 12. Warehouse Guided Onboarding
CREATE TABLE IF NOT EXISTS warehouse_onboarding (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  step text NOT NULL CHECK(step IN ('profile','staff','schedule','labels','imports','opening_balances','review')),
  completed_steps jsonb NOT NULL DEFAULT '[]',
  step_data jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed')),
  policy_version integer NOT NULL DEFAULT 1,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, warehouse_id),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id)
);

-- 13. Policy Snapshots
CREATE TABLE IF NOT EXISTS policy_snapshots (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  policy_version integer NOT NULL,
  policy_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id)
);

CREATE TRIGGER immutable_policy_snapshots BEFORE UPDATE OR DELETE ON policy_snapshots FOR EACH ROW EXECUTE FUNCTION protect_business_events();

-- Indexes for performance and isolation
CREATE INDEX IF NOT EXISTS ledger_scope ON inventory_ledger(org_id, warehouse_id, product_id, location_id);
CREATE INDEX IF NOT EXISTS balances_scope ON inventory_balances(org_id, warehouse_id, product_id);
CREATE INDEX IF NOT EXISTS tasks_scope ON warehouse_tasks(org_id, warehouse_id, status, kind);
CREATE INDEX IF NOT EXISTS po_scope ON purchase_orders(org_id, warehouse_id, status);
CREATE INDEX IF NOT EXISTS transfer_scope ON transfer_orders(org_id, status);
CREATE INDEX IF NOT EXISTS csv_imports_scope ON csv_imports(org_id, warehouse_id, entity_type);
