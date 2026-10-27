CREATE TABLE pallet_groups (
 id text PRIMARY KEY, org_id text NOT NULL, warehouse_id text NOT NULL, trip_id text NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120), version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,warehouse_id), FOREIGN KEY(warehouse_id,org_id) REFERENCES warehouses(id,org_id),
 FOREIGN KEY(trip_id,warehouse_id) REFERENCES trips(id,warehouse_id)
);
CREATE INDEX pallet_groups_scope ON pallet_groups(org_id,warehouse_id,created_at DESC,id DESC);
CREATE TABLE pallet_group_memberships (
 id text PRIMARY KEY, org_id text NOT NULL, warehouse_id text NOT NULL, group_id text NOT NULL, pallet_id text NOT NULL,
 added_by text NOT NULL, removed_by text, added_at timestamptz NOT NULL DEFAULT now(), removed_at timestamptz,
 CHECK((removed_at IS NULL)=(removed_by IS NULL)),
 FOREIGN KEY(group_id,org_id,warehouse_id) REFERENCES pallet_groups(id,org_id,warehouse_id),
 FOREIGN KEY(pallet_id,warehouse_id) REFERENCES pallets(id,warehouse_id),
 FOREIGN KEY(added_by,org_id) REFERENCES company_memberships(user_id,org_id),
 FOREIGN KEY(removed_by,org_id) REFERENCES company_memberships(user_id,org_id)
);
CREATE UNIQUE INDEX pallet_one_active_group ON pallet_group_memberships(org_id,warehouse_id,pallet_id) WHERE removed_at IS NULL;
CREATE INDEX pallet_group_members_scope ON pallet_group_memberships(org_id,warehouse_id,group_id,removed_at);
CREATE FUNCTION protect_pallet_group_membership() RETURNS trigger AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL OR NEW.removed_by IS NULL OR (to_jsonb(NEW)-ARRAY['removed_at','removed_by']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['removed_at','removed_by']) THEN RAISE EXCEPTION 'Pallet grouping history is immutable'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER pallet_group_history BEFORE UPDATE OR DELETE ON pallet_group_memberships FOR EACH ROW EXECUTE FUNCTION protect_pallet_group_membership();
