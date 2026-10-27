-- One legacy namespace per existing company preserves the existing single-warehouse model.
-- This is provenance, not a guessed physical identity/capacity/address.
CREATE TABLE warehouses(
 id text PRIMARY KEY,org_id text NOT NULL REFERENCES organizations(id),code text NOT NULL,name text NOT NULL,
 address text,identity_confirmed boolean NOT NULL DEFAULT false,active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id),UNIQUE(org_id,code)
);
INSERT INTO warehouses(id,org_id,code,name) SELECT id||':legacy',id,'LEGACY','Legacy warehouse · identity unconfirmed' FROM organizations;
CREATE TABLE warehouse_grants(
 user_id text NOT NULL,org_id text NOT NULL,warehouse_id text NOT NULL,
 active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 PRIMARY KEY(user_id,warehouse_id),
 FOREIGN KEY(user_id,org_id) REFERENCES company_memberships(user_id,org_id),
 FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id)
);
INSERT INTO warehouse_grants(user_id,org_id,warehouse_id,active) SELECT user_id,org_id,org_id||':legacy',active FROM company_memberships;
CREATE OR REPLACE FUNCTION bootstrap_legacy_warehouse() RETURNS trigger AS $$ BEGIN
 IF current_setting('warehouse.restoring',true) IS DISTINCT FROM 'true' THEN
 INSERT INTO warehouses(id,org_id,code,name) VALUES(NEW.id||':legacy',NEW.id,'LEGACY','Legacy warehouse · identity unconfirmed');
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER legacy_warehouse AFTER INSERT ON organizations FOR EACH ROW EXECUTE FUNCTION bootstrap_legacy_warehouse();
-- Only a home membership receives legacy access for compatibility. Additional membership needs explicit grants.
CREATE OR REPLACE FUNCTION bootstrap_legacy_access() RETURNS trigger AS $$ BEGIN
 IF current_setting('warehouse.restoring',true) IS DISTINCT FROM 'true' AND EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND org_id=NEW.org_id) THEN
 INSERT INTO warehouse_grants(user_id,org_id,warehouse_id,active) VALUES(NEW.user_id,NEW.org_id,NEW.org_id||':legacy',NEW.active);
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER legacy_access AFTER INSERT ON company_memberships FOR EACH ROW EXECUTE FUNCTION bootstrap_legacy_access();
DROP TRIGGER immutable_events ON inventory_events;
ALTER TABLE locations ADD COLUMN warehouse_id text;
UPDATE locations SET warehouse_id=org_id||':legacy';
ALTER TABLE locations ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE locations ADD CONSTRAINT locations_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE locations ADD CONSTRAINT locations_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE pallets ADD COLUMN warehouse_id text;
UPDATE pallets SET warehouse_id=org_id||':legacy';
ALTER TABLE pallets ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE pallets ADD CONSTRAINT pallets_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE pallets ADD CONSTRAINT pallets_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE boxes ADD COLUMN warehouse_id text;
UPDATE boxes SET warehouse_id=org_id||':legacy';
ALTER TABLE boxes ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE boxes ADD CONSTRAINT boxes_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE boxes ADD CONSTRAINT boxes_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE contents ADD COLUMN warehouse_id text;
UPDATE contents SET warehouse_id=org_id||':legacy';
ALTER TABLE contents ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE contents ADD CONSTRAINT contents_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE contents ADD CONSTRAINT contents_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE orders ADD COLUMN warehouse_id text;
UPDATE orders SET warehouse_id=org_id||':legacy';
ALTER TABLE orders ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE orders ADD CONSTRAINT orders_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE orders ADD CONSTRAINT orders_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE order_lines ADD COLUMN warehouse_id text;
UPDATE order_lines SET warehouse_id=org_id||':legacy';
ALTER TABLE order_lines ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE order_lines ADD CONSTRAINT order_lines_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE order_lines ADD CONSTRAINT order_lines_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE allocations ADD COLUMN warehouse_id text;
UPDATE allocations SET warehouse_id=org_id||':legacy';
ALTER TABLE allocations ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE allocations ADD CONSTRAINT allocations_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE allocations ADD CONSTRAINT allocations_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE preparations ADD COLUMN warehouse_id text;
UPDATE preparations SET warehouse_id=org_id||':legacy';
ALTER TABLE preparations ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE preparations ADD CONSTRAINT preparations_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE preparations ADD CONSTRAINT preparations_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE preparation_orders ADD COLUMN warehouse_id text;
UPDATE preparation_orders SET warehouse_id=org_id||':legacy';
ALTER TABLE preparation_orders ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE preparation_orders ADD CONSTRAINT preparation_orders_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE trips ADD COLUMN warehouse_id text;
UPDATE trips SET warehouse_id=org_id||':legacy';
ALTER TABLE trips ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE trips ADD CONSTRAINT trips_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE trips ADD CONSTRAINT trips_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE stops ADD COLUMN warehouse_id text;
UPDATE stops SET warehouse_id=org_id||':legacy';
ALTER TABLE stops ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE stops ADD CONSTRAINT stops_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE stops ADD CONSTRAINT stops_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE shipments ADD COLUMN warehouse_id text;
UPDATE shipments SET warehouse_id=org_id||':legacy';
ALTER TABLE shipments ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE shipments ADD CONSTRAINT shipments_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE shipments ADD CONSTRAINT shipments_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE shipment_lines ADD COLUMN warehouse_id text;
UPDATE shipment_lines SET warehouse_id=org_id||':legacy';
ALTER TABLE shipment_lines ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE shipment_lines ADD CONSTRAINT shipment_lines_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE shipment_lines ADD CONSTRAINT shipment_lines_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE documents ADD COLUMN warehouse_id text;
UPDATE documents SET warehouse_id=org_id||':legacy';
ALTER TABLE documents ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE documents ADD CONSTRAINT documents_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE documents ADD CONSTRAINT documents_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE issues ADD COLUMN warehouse_id text;
UPDATE issues SET warehouse_id=org_id||':legacy';
ALTER TABLE issues ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE issues ADD CONSTRAINT issues_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE issues ADD CONSTRAINT issues_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE counts ADD COLUMN warehouse_id text;
UPDATE counts SET warehouse_id=org_id||':legacy';
ALTER TABLE counts ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE counts ADD CONSTRAINT counts_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE counts ADD CONSTRAINT counts_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE count_observations ADD COLUMN warehouse_id text;
UPDATE count_observations SET warehouse_id=org_id||':legacy';
ALTER TABLE count_observations ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE count_observations ADD CONSTRAINT count_observations_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE count_observations ADD CONSTRAINT count_observations_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE inventory_events ADD COLUMN warehouse_id text;
UPDATE inventory_events SET warehouse_id=org_id||':legacy';
ALTER TABLE inventory_events ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE inventory_events ADD CONSTRAINT inventory_events_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE inventory_events ADD CONSTRAINT inventory_events_id_warehouse UNIQUE(id,warehouse_id);
ALTER TABLE operations ADD COLUMN warehouse_id text;
UPDATE operations SET warehouse_id=org_id||':legacy';
ALTER TABLE operations ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE operations ADD CONSTRAINT operations_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE jobs ADD COLUMN warehouse_id text;
UPDATE jobs SET warehouse_id=org_id||':legacy';
ALTER TABLE jobs ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE jobs ADD CONSTRAINT jobs_warehouse_company FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id);
ALTER TABLE jobs ADD CONSTRAINT jobs_id_warehouse UNIQUE(id,warehouse_id);
CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON inventory_events FOR EACH ROW EXECUTE FUNCTION protect_business_events();
CREATE OR REPLACE FUNCTION inherit_operational_warehouse() RETURNS trigger AS $$ BEGIN
 IF NEW.warehouse_id IS NULL THEN
 CASE TG_TABLE_NAME
 WHEN 'pallets' THEN SELECT warehouse_id INTO NEW.warehouse_id FROM locations WHERE id=NEW.location_id;
 WHEN 'boxes' THEN IF NEW.pallet_id IS NOT NULL THEN SELECT warehouse_id INTO NEW.warehouse_id FROM pallets WHERE id=NEW.pallet_id; ELSE SELECT warehouse_id INTO NEW.warehouse_id FROM locations WHERE id=NEW.location_id; END IF;
 WHEN 'contents' THEN SELECT warehouse_id INTO NEW.warehouse_id FROM boxes WHERE id=NEW.box_id;
 WHEN 'order_lines' THEN SELECT warehouse_id INTO NEW.warehouse_id FROM orders WHERE id=NEW.order_id;
 WHEN 'allocations' THEN SELECT warehouse_id INTO NEW.warehouse_id FROM boxes WHERE id=NEW.box_id;
 WHEN 'preparation_orders' THEN SELECT warehouse_id INTO NEW.warehouse_id FROM preparations WHERE id=NEW.preparation_id;
 WHEN 'stops' THEN SELECT warehouse_id INTO NEW.warehouse_id FROM trips WHERE id=NEW.trip_id;
 WHEN 'shipments' THEN SELECT warehouse_id INTO NEW.warehouse_id FROM orders WHERE id=NEW.order_id;
 WHEN 'shipment_lines' THEN SELECT warehouse_id INTO NEW.warehouse_id FROM shipments WHERE id=NEW.shipment_id;
 WHEN 'documents' THEN SELECT warehouse_id INTO NEW.warehouse_id FROM boxes WHERE id=NEW.box_id;
 WHEN 'issues' THEN SELECT warehouse_id INTO NEW.warehouse_id FROM boxes WHERE id=NEW.box_id;
 WHEN 'counts' THEN SELECT warehouse_id INTO NEW.warehouse_id FROM locations WHERE id=NEW.location_id;
 WHEN 'count_observations' THEN SELECT warehouse_id INTO NEW.warehouse_id FROM counts WHERE id=NEW.count_id;
 ELSE NEW.warehouse_id:=NEW.org_id||':legacy';
 END CASE;
 IF NEW.warehouse_id IS NULL THEN NEW.warehouse_id:=NEW.org_id||':legacy'; END IF;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON locations FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON pallets FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON boxes FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON contents FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON order_lines FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON allocations FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON preparations FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON preparation_orders FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON trips FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON stops FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON shipments FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON shipment_lines FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON documents FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON issues FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON counts FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON count_observations FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON inventory_events FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON operations FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
CREATE TRIGGER z_warehouse_scope BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION inherit_operational_warehouse();
ALTER TABLE pallets ADD CONSTRAINT pallets_location_id_warehouse FOREIGN KEY(location_id,warehouse_id) REFERENCES locations(id,warehouse_id);
ALTER TABLE boxes ADD CONSTRAINT boxes_location_id_warehouse FOREIGN KEY(location_id,warehouse_id) REFERENCES locations(id,warehouse_id);
ALTER TABLE boxes ADD CONSTRAINT boxes_pallet_id_warehouse FOREIGN KEY(pallet_id,warehouse_id) REFERENCES pallets(id,warehouse_id);
ALTER TABLE contents ADD CONSTRAINT contents_box_id_warehouse FOREIGN KEY(box_id,warehouse_id) REFERENCES boxes(id,warehouse_id);
ALTER TABLE order_lines ADD CONSTRAINT order_lines_order_id_warehouse FOREIGN KEY(order_id,warehouse_id) REFERENCES orders(id,warehouse_id);
ALTER TABLE allocations ADD CONSTRAINT allocations_order_id_warehouse FOREIGN KEY(order_id,warehouse_id) REFERENCES orders(id,warehouse_id);
ALTER TABLE allocations ADD CONSTRAINT allocations_order_line_id_warehouse FOREIGN KEY(order_line_id,warehouse_id) REFERENCES order_lines(id,warehouse_id);
ALTER TABLE allocations ADD CONSTRAINT allocations_box_id_warehouse FOREIGN KEY(box_id,warehouse_id) REFERENCES boxes(id,warehouse_id);
ALTER TABLE allocations ADD CONSTRAINT allocations_contents_id_warehouse FOREIGN KEY(contents_id,warehouse_id) REFERENCES contents(id,warehouse_id);
ALTER TABLE preparation_orders ADD CONSTRAINT preparation_orders_preparation_id_warehouse FOREIGN KEY(preparation_id,warehouse_id) REFERENCES preparations(id,warehouse_id);
ALTER TABLE preparation_orders ADD CONSTRAINT preparation_orders_order_id_warehouse FOREIGN KEY(order_id,warehouse_id) REFERENCES orders(id,warehouse_id);
ALTER TABLE preparation_orders ADD CONSTRAINT preparation_orders_staging_location_id_warehouse FOREIGN KEY(staging_location_id,warehouse_id) REFERENCES locations(id,warehouse_id);
ALTER TABLE stops ADD CONSTRAINT stops_trip_id_warehouse FOREIGN KEY(trip_id,warehouse_id) REFERENCES trips(id,warehouse_id);
ALTER TABLE shipments ADD CONSTRAINT shipments_order_id_warehouse FOREIGN KEY(order_id,warehouse_id) REFERENCES orders(id,warehouse_id);
ALTER TABLE shipments ADD CONSTRAINT shipments_trip_id_warehouse FOREIGN KEY(trip_id,warehouse_id) REFERENCES trips(id,warehouse_id);
ALTER TABLE shipments ADD CONSTRAINT shipments_stop_id_warehouse FOREIGN KEY(stop_id,warehouse_id) REFERENCES stops(id,warehouse_id);
ALTER TABLE shipment_lines ADD CONSTRAINT shipment_lines_shipment_id_warehouse FOREIGN KEY(shipment_id,warehouse_id) REFERENCES shipments(id,warehouse_id);
ALTER TABLE shipment_lines ADD CONSTRAINT shipment_lines_box_id_warehouse FOREIGN KEY(box_id,warehouse_id) REFERENCES boxes(id,warehouse_id);
ALTER TABLE documents ADD CONSTRAINT documents_box_id_warehouse FOREIGN KEY(box_id,warehouse_id) REFERENCES boxes(id,warehouse_id);
ALTER TABLE issues ADD CONSTRAINT issues_box_id_warehouse FOREIGN KEY(box_id,warehouse_id) REFERENCES boxes(id,warehouse_id);
ALTER TABLE counts ADD CONSTRAINT counts_location_id_warehouse FOREIGN KEY(location_id,warehouse_id) REFERENCES locations(id,warehouse_id);
ALTER TABLE count_observations ADD CONSTRAINT count_observations_count_id_warehouse FOREIGN KEY(count_id,warehouse_id) REFERENCES counts(id,warehouse_id);
CREATE INDEX boxes_warehouse_page ON boxes(org_id,warehouse_id,created_at);
CREATE INDEX orders_warehouse_page ON orders(org_id,warehouse_id,created_at);
CREATE INDEX shipments_warehouse_page ON shipments(org_id,warehouse_id,created_at);
CREATE INDEX jobs_warehouse_page ON jobs(org_id,warehouse_id,created_at);
CREATE INDEX inventory_events_warehouse_page ON inventory_events(org_id,warehouse_id,created_at);

ALTER TABLE locations DROP CONSTRAINT locations_org_id_code_key;
ALTER TABLE locations ADD CONSTRAINT locations_warehouse_code UNIQUE(org_id,warehouse_id,code);
