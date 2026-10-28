-- 018_traceability_recalls_offline_sync.sql
-- P2 Batch/Serial/Expiry Tracing, Quality Holds, Recalls and Scoped Offline Sync

-- 1. Serial Number Tracking
CREATE TABLE IF NOT EXISTS item_serials (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  product_id text NOT NULL REFERENCES products(id),
  lot_id text REFERENCES lots(id),
  serial_number text NOT NULL CHECK(length(serial_number) BETWEEN 1 AND 120),
  box_id text REFERENCES boxes(id),
  location_id text REFERENCES locations(id),
  status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','stored','allocated','picked','packed','in_transit','delivered','returned','quarantined','scrapped')),
  quarantine_hold_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, product_id, serial_number),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id)
);

CREATE INDEX IF NOT EXISTS item_serials_lookup ON item_serials(org_id, warehouse_id, product_id, status);

-- 2. Lots Metadata Extension
ALTER TABLE lots ADD COLUMN IF NOT EXISTS manufactured_on date;
ALTER TABLE lots ADD COLUMN IF NOT EXISTS supplier_lot_reference text;
ALTER TABLE lots ADD COLUMN IF NOT EXISTS origin_country text;
ALTER TABLE lots ADD COLUMN IF NOT EXISTS quality_status text NOT NULL DEFAULT 'released' CHECK(quality_status IN ('released','quarantine','recalled','expired'));
ALTER TABLE lots ADD COLUMN IF NOT EXISTS cold_chain_min_temp numeric(8,3);
ALTER TABLE lots ADD COLUMN IF NOT EXISTS cold_chain_max_temp numeric(8,3);

-- 3. Quality Quarantine Holds
CREATE TABLE IF NOT EXISTS quality_holds (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  scope text NOT NULL CHECK(scope IN ('product','lot','serial','box','location')),
  target_id text NOT NULL CHECK(length(target_id) BETWEEN 1 AND 120),
  reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 2000),
  severity text NOT NULL DEFAULT 'major' CHECK(severity IN ('critical','major','minor')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','released')),
  authorized_by text NOT NULL REFERENCES users(id),
  released_by text REFERENCES users(id),
  released_at timestamptz,
  release_reason text,
  disposition text CHECK(disposition IS NULL OR disposition IN ('scrap','return_to_supplier','rework','release_as_is')),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id)
);

CREATE INDEX IF NOT EXISTS quality_holds_active_lookup ON quality_holds(org_id, warehouse_id, status, scope, target_id);

-- 4. Authoritative Recalls & Forward/Backward Impact Analysis
CREATE TABLE IF NOT EXISTS recalls (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  code text NOT NULL CHECK(length(code) BETWEEN 1 AND 80),
  title text NOT NULL CHECK(length(title) BETWEEN 3 AND 200),
  product_id text NOT NULL REFERENCES products(id),
  lot_id text REFERENCES lots(id),
  reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 4000),
  severity text NOT NULL CHECK(severity IN ('class_1','class_2','class_3')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
  quality_hold_id text REFERENCES quality_holds(id),
  affected_on_hand_boxes integer NOT NULL DEFAULT 0,
  affected_delivered_boxes integer NOT NULL DEFAULT 0,
  initiated_by text NOT NULL REFERENCES users(id),
  initiated_at timestamptz NOT NULL DEFAULT now(),
  closed_by text REFERENCES users(id),
  closed_at timestamptz,
  closure_notes text,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, code),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id)
);

CREATE INDEX IF NOT EXISTS recalls_status_lookup ON recalls(org_id, warehouse_id, status);

-- 5. Scoped Offline Sync Outbox & Operation Registry
CREATE TABLE IF NOT EXISTS sync_outbox (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  warehouse_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id),
  command text NOT NULL CHECK(length(command) BETWEEN 1 AND 120),
  endpoint text NOT NULL,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  expected_version integer,
  depends_on_operation_id text,
  file_upload_id text,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','uploading_file','syncing','confirmed','conflict','failed')),
  conflict_details jsonb,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  error_message text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(warehouse_id, org_id) REFERENCES warehouses(id, org_id)
);

CREATE INDEX IF NOT EXISTS sync_outbox_queue ON sync_outbox(org_id, warehouse_id, user_id, status, created_at);
