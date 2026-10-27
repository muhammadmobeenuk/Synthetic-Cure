-- Existing users.org_id is retained as home/provenance; memberships become active authorization.
CREATE TABLE company_memberships(
 user_id text NOT NULL REFERENCES users(id),org_id text NOT NULL REFERENCES organizations(id),
 role text NOT NULL,active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,org_id)
);
INSERT INTO company_memberships(user_id,org_id,role,active) SELECT id,org_id,role,active FROM users;
-- Ambiguous case-insensitive login identities must be reconciled, never silently merged.
CREATE UNIQUE INDEX users_email_case_insensitive ON users(lower(email));
CREATE OR REPLACE FUNCTION bootstrap_home_membership() RETURNS trigger AS $$ BEGIN
 IF current_setting('warehouse.restoring',true) IS DISTINCT FROM 'true' THEN
 INSERT INTO company_memberships(user_id,org_id,role,active) VALUES(NEW.id,NEW.org_id,NEW.role,NEW.active);
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER home_membership AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION bootstrap_home_membership();
ALTER TABLE inventory_events DROP CONSTRAINT inventory_events_actor_id_company;
ALTER TABLE inventory_events ADD CONSTRAINT inventory_events_actor_id_membership FOREIGN KEY(actor_id,org_id) REFERENCES company_memberships(user_id,org_id);
ALTER TABLE jobs DROP CONSTRAINT jobs_actor_id_company;
ALTER TABLE jobs ADD CONSTRAINT jobs_actor_id_membership FOREIGN KEY(actor_id,org_id) REFERENCES company_memberships(user_id,org_id);
ALTER TABLE count_observations DROP CONSTRAINT count_observations_actor_id_company;
ALTER TABLE count_observations ADD CONSTRAINT count_observations_actor_id_membership FOREIGN KEY(actor_id,org_id) REFERENCES company_memberships(user_id,org_id);
ALTER TABLE trips DROP CONSTRAINT trips_driver_id_company;
ALTER TABLE trips ADD CONSTRAINT trips_driver_id_membership FOREIGN KEY(driver_id,org_id) REFERENCES company_memberships(user_id,org_id);
ALTER TABLE company_configuration_revisions DROP CONSTRAINT company_configuration_revisions_actor_id_org_id_fkey;
ALTER TABLE company_configuration_revisions ADD CONSTRAINT configuration_actor_membership FOREIGN KEY(actor_id,org_id) REFERENCES company_memberships(user_id,org_id);
