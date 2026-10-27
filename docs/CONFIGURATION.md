# Company configuration · PLATFORM-001

One core source tree supports a dedicated installation or multiple isolated company records. Staff identities may have versioned memberships with different roles per company and explicit warehouse grants. Selected contexts are server validated; the browser cannot choose arbitrary ownership. See ACCESS.md for scope, compatibility and remaining identity-provisioning limits. Native PostgreSQL/shared deployment readiness gates remain.


## Configure a company

An administrator opens Settings → Company setup. Save and resume:
1. Identity: company display name and optional intended operating profile.
2. Locale: valid IANA timezone, English/Chinese language preference and date format.
3. Preparation: suggested weekdays, or no weekdays for ad-hoc batches.

Each step requires a source/reason, expected version and stable operation ID. Successful changes increase the version, record an immutable typed revision and append an audit event containing previous/current values. A stale form keeps its entries; reload current settings, compare and explicitly reconcile before retrying.

These are three foundational onboarding steps, not a complete operational readiness approval. Language preference affects date labels; the interface is not fully translated. Choosing a profile does not enable unimplemented modules or validate food safety. There is no editable permission-limit policy or automatic stock-owner assignment.

## JadeSun preset

The known synthetic JadeSun seed uses Europe/London and Wednesday suggestions. Real existing companies retain their name, while unreviewed locale and schedules stay null/ad-hoc. No arbitrary existing company receives JadeSun rules. Administrators can confirm the actual JadeSun settings through the same UI.

The preparation board suggests a date from the configured weekdays. Creating an empty batch is explicit; no scheduled background job duplicates orders or creates orders. Delivery date/driver/trip remain separate. New preparation batches snapshot configuration version, timezone and weekdays. Later changes do not rewrite that historical snapshot. Older batches have a null policy snapshot, shown/documented as legacy/unconfirmed.

## New installation / company

Use one PostgreSQL database and private file store as documented in OPERATIONS.md. In the server environment set a stable COMPANY_ID and COMPANY_NAME with the initial ADMIN_EMAIL/ADMIN_PASSWORD. Run db:migrate then db:seed in production mode. Repeating provisioning of the same COMPANY_ID does not rename the company or reset stock. Separate company administrators need distinct email identities in the current candidate. Never copy synthetic demo users into live operation.

## Deferred configuration

Warehouse access, shifts, cut-offs, selection policies, verified conversions, substitution/partial-fulfilment policy, label templates/printer adapters, tracking marks, handover evidence and retention configuration need separate validated slices. The existing proposed permission policy and manual tracking rules remain explicit; no arbitrary executable rules are accepted.

Product import uses the currently supported catalogue units/profiles, with no unrestricted custom-unit creation. Warehouse permissions gate review provenance while products remain company-shared. See IMPORTS.md.
