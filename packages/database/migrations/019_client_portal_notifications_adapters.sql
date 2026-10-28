-- Migration 019: Client Portal, Notifications, and Carrier/Accounting Adapters Foundation

CREATE TABLE IF NOT EXISTS client_portal_users (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id),
  user_id VARCHAR(64) NOT NULL REFERENCES users(id),
  customer_id VARCHAR(64) REFERENCES customers(id),
  stock_owner_id VARCHAR(64) REFERENCES stock_owners(id),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1,
  CONSTRAINT uq_client_portal_user UNIQUE (org_id, user_id),
  CONSTRAINT chk_portal_linkage CHECK (customer_id IS NOT NULL OR stock_owner_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_client_portal_customer ON client_portal_users(org_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_client_portal_owner ON client_portal_users(org_id, stock_owner_id);

CREATE TABLE IF NOT EXISTS notification_endpoints (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id),
  warehouse_id VARCHAR(64) REFERENCES warehouses(id),
  url VARCHAR(1000) NOT NULL,
  event_topics JSONB NOT NULL DEFAULT '[]',
  secret VARCHAR(128) NOT NULL,
  description VARCHAR(255),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INT NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_notification_endpoints_org ON notification_endpoints(org_id, warehouse_id);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id),
  warehouse_id VARCHAR(64) REFERENCES warehouses(id),
  endpoint_id VARCHAR(64) NOT NULL REFERENCES notification_endpoints(id) ON DELETE CASCADE,
  event_topic VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  signature VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  status_code INT,
  response_body TEXT,
  error_message TEXT,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_endpoint ON notification_deliveries(org_id, endpoint_id, created_at DESC);

CREATE TABLE IF NOT EXISTS carrier_manifests (
  id VARCHAR(64) PRIMARY KEY,
  org_id VARCHAR(64) NOT NULL REFERENCES organizations(id),
  warehouse_id VARCHAR(64) NOT NULL REFERENCES warehouses(id),
  trip_id VARCHAR(64) NOT NULL REFERENCES trips(id),
  carrier_code VARCHAR(50) NOT NULL,
  carrier_name VARCHAR(100) NOT NULL,
  service_level VARCHAR(50),
  tracking_reference VARCHAR(100),
  vehicle_type_required VARCHAR(100),
  special_instructions TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'booked',
  manifest_data JSONB NOT NULL DEFAULT '{}',
  total_pallets INT NOT NULL DEFAULT 0,
  total_boxes INT NOT NULL DEFAULT 0,
  total_weight_kg NUMERIC(12, 3),
  booked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  manifested_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_carrier_manifest_trip UNIQUE (org_id, trip_id)
);

CREATE INDEX IF NOT EXISTS idx_carrier_manifests_status ON carrier_manifests(org_id, warehouse_id, status);
