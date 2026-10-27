CREATE TABLE product_imports(
 id text PRIMARY KEY,org_id text NOT NULL REFERENCES organizations(id),warehouse_id text NOT NULL,
 actor_id text NOT NULL,filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 200),
 source_csv text NOT NULL CHECK(octet_length(source_csv)<=262144),source_hash text NOT NULL CHECK(length(source_hash)=64),
 identity_hash text NOT NULL CHECK(length(identity_hash)=64),mapping jsonb NOT NULL,policy_version integer NOT NULL DEFAULT 1 CHECK(policy_version=1),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),status text NOT NULL DEFAULT 'review' CHECK(status IN ('review','committed')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now(),committed_at timestamptz,
 CHECK((status='committed')=(committed_at IS NOT NULL)),UNIQUE(id,org_id,warehouse_id),UNIQUE(org_id,warehouse_id,identity_hash),
 FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id),
 FOREIGN KEY(actor_id,org_id) REFERENCES company_memberships(user_id,org_id)
);
CREATE INDEX product_imports_page ON product_imports(org_id,warehouse_id,created_at DESC,id DESC);
CREATE TABLE product_import_items(
 import_id text NOT NULL,org_id text NOT NULL,warehouse_id text NOT NULL,source_line integer NOT NULL CHECK(source_line>1),product_id text NOT NULL,
 PRIMARY KEY(import_id,source_line),UNIQUE(org_id,product_id),
 FOREIGN KEY(import_id,org_id,warehouse_id) REFERENCES product_imports(id,org_id,warehouse_id),
 FOREIGN KEY(product_id,org_id) REFERENCES products(id,org_id)
);
CREATE FUNCTION protect_product_import() RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Import history cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','version','committed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','committed_at']) OR OLD.status='committed' OR NEW.status<>'committed' OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Import source/history is immutable'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER immutable_import_source BEFORE UPDATE OR DELETE ON product_imports FOR EACH ROW EXECUTE FUNCTION protect_product_import();
CREATE TRIGGER immutable_import_items BEFORE UPDATE OR DELETE ON product_import_items FOR EACH ROW EXECUTE FUNCTION protect_business_events();
