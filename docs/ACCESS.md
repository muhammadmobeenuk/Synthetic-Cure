# Company membership and warehouse access · PLATFORM-002

A global staff identity may have multiple company memberships. Each membership has its own role, active state and version. `users.org_id` and `users.role` remain legacy home/provenance fields; they no longer select active authorization. Users retain stable IDs; historical events reference company membership, which is deactivated rather than deleted.

## Select a workspace

Settings → Company & warehouse lists only your active memberships and assigned warehouses. Selecting another company opens its first assigned warehouse; selecting a warehouse explicitly requires its grant. A company with no warehouse grant offers setup/recovery only, with operational data blocked. Every request resolves membership and grants from database state. A browser-supplied ID is a selection request, never ownership authority.

Context switching regenerates the session and CSRF token. Context headers protect old forms from writing after another tab changes workspace. They are preconditions only; the server still derives actor/company/warehouse. Omitted headers remain accepted for legacy API clients, which must refresh context before edits. Current browser clients always send them. Label/document links use server scope rather than browser context headers.

## Manage access

Company administrators can create a named warehouse, review a legacy warehouse identity, add/update membership of an existing staff identity, or assign/revoke warehouse access. Each command uses expectedVersion, stable operation ID and a reason, with immutable business audit. Version 0 creates a relationship; later changes require its current version. The last active company administrator cannot be removed/demoted; a company row lock serializes competing changes.

Membership in another company gives no warehouse access automatically. The original home namespace retains its historical grants; trusted server-side creation of a home identity bootstraps that legacy namespace for compatibility. Identity creation is not exposed as a public sign-up or unrestricted invite endpoint. New staff identities still require deployment provisioning; no emails/invitations are sent by this screen.

Proposed roles remain administrator, supervisor, operator, dispatcher, driver, reviewer. Actual staff approval limits remain unconfirmed. Company-wide configuration (including product tracking policies) is administrator controlled. Catalogue identity is company shared; physical inventory, operational orders and documents are warehouse scoped. Drivers additionally see only assigned trips/shipments/stops.

## Warehouse boundaries

Locations, physical units, contents, orders/lines/allocations, preparation, trips/stops/shipments, documents/issues/counts, events/idempotency and jobs carry warehouse identity. Composite foreign keys reject cross-warehouse containment, allocation or movement links. Location codes may repeat in different warehouses; internal box identities stay stable and company unique. Moving stock to another warehouse through a normal movement is rejected. A transactional in-transit transfer workflow is a later slice.

Workspace lists/search, detail reads, file URLs, labels, exports and workers apply the selected warehouse. Commands revalidate membership/role/grants inside the stock transaction, before cached idempotent results. Queued jobs recheck current permissions/grants. Revocation retains history and pending captures, not access.

## Device work

Draft/cache scope is company + warehouse + user. Old single-namespace drafts are recovered only in the original home company's legacy warehouse. Navigation through app controls and context switching save incomplete receipt/count captures first; failed device storage blocks that navigation. Explicit Save draft remains necessary before browser reload/closing the tab. Captured task forms are visible in Settings for manual recovery and are not an automatic sync queue. They may include work completed elsewhere; always compare authoritative state.

Logout warns about saved device work, logs out on the server, then clears that identity's saved drafts across contexts. Failed server logout does not erase the drafts. No stock availability or final dispatch is confirmed offline.

## Readiness boundary

Native PostgreSQL isolation/races/restore still require two disposable databases. PGlite/HTTP tests do not prove native lock behaviour. Invitations/password lifecycle, stock-owner clients, warehouse transfers and automatic sync remain separate work. Do not roll back to a release that ignores warehouse/membership scope against an upgraded multi-warehouse database.
