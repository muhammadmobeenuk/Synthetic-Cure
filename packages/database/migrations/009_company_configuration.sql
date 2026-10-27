-- Existing companies retain identity. Operational policy stays unconfirmed unless explicitly reviewed.
CREATE TABLE company_configuration (
 org_id text PRIMARY KEY REFERENCES organizations(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 200),
 timezone text,
 language text CHECK(language IN ('en','zh')),
 date_format text CHECK(date_format IN ('day-first','iso')),
 operating_profile text CHECK(operating_profile IN ('general','wholesale','food','printed','3pl')),
 preparation_weekdays smallint[] NOT NULL DEFAULT '{}',
 identity_reviewed boolean NOT NULL DEFAULT false,
 locale_reviewed boolean NOT NULL DEFAULT false,
 schedule_reviewed boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(preparation_weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[] AND cardinality(preparation_weekdays)<=7),
 CHECK(NOT locale_reviewed OR (timezone IS NOT NULL AND language IS NOT NULL AND date_format IS NOT NULL))
);
INSERT INTO company_configuration(org_id,display_name) SELECT id,name FROM organizations;
-- Only the known synthetic seed is given a demo preset. Real companies must review settings.
UPDATE company_configuration SET timezone='Europe/London',language='en',date_format='day-first',preparation_weekdays=ARRAY[3]::smallint[] WHERE org_id IN (SELECT id FROM organizations WHERE id='demo' AND demo=true);
CREATE TABLE company_configuration_revisions (
 org_id text NOT NULL REFERENCES organizations(id),
 version integer NOT NULL CHECK(version>0),
 section text NOT NULL CHECK(section IN ('identity','locale','schedule')),
 actor_id text NOT NULL,
 reason text NOT NULL,
 display_name text NOT NULL,
 timezone text,
 language text,
 date_format text,
 operating_profile text,
 preparation_weekdays smallint[] NOT NULL,
 identity_reviewed boolean NOT NULL,
 locale_reviewed boolean NOT NULL,
 schedule_reviewed boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,version),
 FOREIGN KEY(actor_id,org_id) REFERENCES users(id,org_id)
);
CREATE TRIGGER immutable_configuration_revisions BEFORE UPDATE OR DELETE ON company_configuration_revisions FOR EACH ROW EXECUTE FUNCTION protect_business_events();
ALTER TABLE preparations ADD COLUMN configuration_version integer;
ALTER TABLE preparations ADD COLUMN policy_snapshot jsonb;
-- No invented historical snapshot; older preparations remain explicitly legacy/unconfirmed.
