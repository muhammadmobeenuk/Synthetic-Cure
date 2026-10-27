CREATE TABLE suppliers (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id), code text NOT NULL CHECK(length(code) BETWEEN 1 AND 120), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id), UNIQUE(org_id,code)
);
CREATE TABLE expected_receipts (
 id text PRIMARY KEY, org_id text NOT NULL, warehouse_id text NOT NULL, supplier_id text NOT NULL, product_id text NOT NULL,
 reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 200), expected_date date NOT NULL, quantity numeric(18,6) NOT NULL CHECK(quantity>0), unit text NOT NULL CHECK(length(unit) BETWEEN 1 AND 30),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,warehouse_id), FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id),
 FOREIGN KEY(supplier_id,org_id) REFERENCES suppliers(id,org_id), FOREIGN KEY(product_id,org_id) REFERENCES products(id,org_id)
);
CREATE INDEX expected_receipts_scope ON expected_receipts(org_id,warehouse_id,created_at DESC,id DESC);
CREATE FUNCTION protect_expected_receipt() RETURNS trigger AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'version') IS DISTINCT FROM (to_jsonb(OLD)-'version') OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Expected receipt history is immutable'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER immutable_expected_receipt BEFORE UPDATE OR DELETE ON expected_receipts FOR EACH ROW EXECUTE FUNCTION protect_expected_receipt();
CREATE TABLE expected_receipt_boxes (
 id text PRIMARY KEY, org_id text NOT NULL, warehouse_id text NOT NULL, expected_receipt_id text NOT NULL, box_id text NOT NULL,
 quantity numeric(18,6) NOT NULL CHECK(quantity>0), unit text NOT NULL, receipt_state text NOT NULL CHECK(receipt_state IN ('accepted','held','pending')), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(box_id), FOREIGN KEY(expected_receipt_id,org_id,warehouse_id) REFERENCES expected_receipts(id,org_id,warehouse_id),
 FOREIGN KEY(box_id,warehouse_id) REFERENCES boxes(id,warehouse_id)
);
CREATE TRIGGER immutable_expected_receipt_box BEFORE UPDATE OR DELETE ON expected_receipt_boxes FOR EACH ROW EXECUTE FUNCTION protect_business_events();
