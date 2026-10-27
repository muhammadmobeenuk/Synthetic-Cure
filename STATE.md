# Current candidate · WMS-MODERN-001

Modernizes warehouse floor input ergonomics and strengthens operational safety logic. Integrates high-speed fuzzy searchable comboboxes, quantity steppers with unit affixes and quick-fill triggers, hardware barcode scanner listener (useBarcodeScanner) with GS1-128 AI parser (01, 10, 17, 21), and tactile/auditory Web Audio and haptic feedback (playScanFeedback). Enforces FEFO (First-Expired, First-Out) picking and allocation order. Adds real-time Available-to-Promise (ATP) stock badges to order entry. Scopes destination selection to customer branches. Enforces cold-chain putaway environmental checks across receiving and internal movements. Adds touch-first digital signature pad (SmartSignaturePad) with delivery disposition tags to driver handover e-POD. Adds trip payload deck metrics and pallet capacity validation during trip planning.

Verification: PASSED: tsc --noEmit (strict TypeScript, zero errors); npm run build (Vite client bundle compiled in 520ms); unit test suite (tests/smart-inputs.test.ts, 4/4 passed); core regression tests (tests/api-response.test.ts, tests/csv.test.ts, tests/signout.test.ts, 12/12 passed).

Limits: Native PostgreSQL concurrency/migration/restore still blocked without two disposable URLs. Physical warehouse handheld terminals and Bluetooth ring scanner devices remain unverified. Automatic offline sync and live OCR remain unchanged. Production readiness is not claimed.

## Previous candidate · PLATFORM-003

Preserves PLATFORM-002 source 7e9ace7 and existing working warehouse operations. Adds create-only company product CSV import scoped to the reviewing warehouse. Private originals, mapping, source hash/policy and product links persist. Strict units/profiles, bilingual names/leading zeros retained; previews add no stock/products; revalidation and atomic commit prevent partial imports and duplicates. Administrator-only initial permission. Settings/onboarding claims updated.

Verification: baseline 71 tests (70 pass, one native skip); expanded 84 tests (83 pass, zero fail, one native skip); strict TypeScript/build passed. Synthetic browser invalid-unit preview blocked commit; error report downloaded; corrected two-product commit and reload succeeded. Device layouts/package/publication results: evidence/PLATFORM-003.md.

Limits: file chooser timed out (manual paste verified); native PostgreSQL concurrency/migration/restore still blocked without two disposable URLs. External UI review blocked by automatic approval review, existing UI components retained. Customer/supplier/orders/opening imports, full staff lifecycle, stock-owner access, quantity/serial/weight ledger, inter-warehouse transfer/tasks, automatic sync/OCR and production gates remain unfinished. No real stock/documents/prices invented.

Next bounded task: atomic customer/destination CSV import with validated relationships and unconfirmed address default. Opening balances remain separate cut-over/reconciliation.

## Synthetic Cure branding slice
Application navigation/title and newly seeded demo use Synthetic Cure. Existing company identities, sessions, data, storage keys and history are preserved. User clarified one initial warehouse, web/PWA plus Android and iOS aspirations, offline capture for all listed observations and PowerPoint; actual app packaging, outbox sync, PowerPoint generation, and super-pallet semantics remain unimplemented/unconfirmed. See PROJECT.md.

## Customer order form candidate
Multi-product internal order entry, explicit quantities/units, scoped drafts and idempotent retry added; 84 tests passed, one native-only skipped, build/type checks passed. Browser full backend created a two-product synthetic order and retained it after reload. See evidence/CUSTOMER-ORDER-001.md. Printed customer order sheet and logical multi-pallet grouping remain unimplemented. Existing historical duplicate-product order totals need reconciliation. Next: logical pallet grouping linked to trip/driver with verified manifest constraints; no physical nesting assumption.

## Pallet-group planning candidate
Separate pallets can be grouped for an existing trip, added/removed with version checks and immutable membership history. This is planning only, not physical nesting, shipment allocation, load verification or dispatch. 87 tests passed, one native-only skipped; TypeScript/build passed. Browser showed the new empty state but end-to-end group creation was blocked by no planned trip in the test workspace. Native PostgreSQL and physical devices remain unverified. See evidence/PALLET-GROUP-001.md. Next: customer-facing printable order form and destination-specific reconciliation of pallet groups against shipment manifests.

## Worker sheet and AI review candidate

An authorized staff-only print view derives order, preparation, allocation, box, pallet and destination data from complete scoped records. It is a point-in-time working copy, not an invoice and not proof of dispatch. Browser paper marks do not change stock. A local Tesseract adapter and optional Gemini adapter queue private selected images for unreviewed transcription; neither makes domain changes. Gemini needs a server-only key/model and explicit per-document external-transfer confirmation. Images only; no PDF OCR or automated field validation. English Tesseract is installed in the development environment; Chinese language data must be installed and configured separately. See docs/AI-RECOGNITION.md.

Limitations: live Gemini and physical printing are unverified; worker holds a transaction during extraction; output retention settings and automatic offline sync are absent. The online device-local demo may not contain these server-backed changes. Customer-facing invoice and recipient-label generation remain separate work. Native PostgreSQL tests and production recovery gates remain open.

## Approved premium shared UI candidate

The existing shell and reusable controls use the approved teal navigation/header, jade actions, warm surfaces and restrained gold accents. Existing section names, actions, demo/offline signals, warehouse identity and permissions remain. Active desktop navigation exposes `aria-current`. `docs/UI-RULES.md` records the approved design and operational boundaries. Desktop browser navigation opened all 16 existing sections in the PGlite demo. Typecheck and build passed.

The section-specific layouts are not yet recreated to match the approved images, and a phone/tablet visual inspection was not performed. The 12ui hosted image conversion stopped at sign-in; no pixel-fidelity claim. The hosted browser-local preview is unchanged. The previous full test suite was not rerun for this CSS-only slice. Native PostgreSQL remains unverified.

## Approved screen layout implementation · first three sections

Orders, Preparation and Pallets now use searchable list/detail layouts based on the approved design. Existing scoped order, batch and pallet commands are preserved. Preparation shows actual stage counts and keeps delivery separate; unknown staging remains unconfirmed. Selection does not mutate stock. Browser demo verified synthetic order search/selection, preparation selection and opening the existing advance dialog, and pallet selection. `npm run verify`: 90 pass, zero fail, one native-only skipped; TypeScript/build passed. The search empty-state text was added during the run and separately typechecked and built. Phone/tablet visual checks, native PostgreSQL and full screen-by-screen fidelity remain unverified. Remaining sections retain the prior layout with shared premium styling; they have not yet been redesigned.

## Creator attribution

The supplied MM symbol and “Created by Mobeen” appear on the sidebar and sign-in screen; Synthetic Cure remains the product name. The separate signature image references another product and is not included. Source and demo typecheck/build passed; the desktop demo sidebar was visually inspected. Login and phone/tablet presentation have not been visually inspected in this slice; existing work and permissions were not changed.

## Locations and products UX

Locations and Products & Batches use searchable lists with selected details while preserving the existing section menu, fonts and actions. Unknown capacities and pack conversions remain unknown; location box counts are explicitly loaded records. Browser demo verified location selection and Chinese product search. Both application and demo builds/typechecks passed. Other sections still require individual redesign; phone/tablet visual checks and full workflow tests were not run for this slice.

## Customer and destination UX

Customers & Destinations uses a searchable list with a selected detail, preserving recipient authorizations, address verification and add actions. Counts describe loaded data; address and identity unknowns remain unconfirmed. Demo browser verified customer selection and Chinese-name search; source/demo typecheck and builds passed. Other sections still need individual UX work. Phone/tablet visual tests and end-to-end address mutations were not run.

## Dispatch UX

Dispatch now provides a searchable active-shipment list and selected manifest, preserving load and dispatch dialogs and keeping delivery separate. Fonts and section navigation remain unchanged. Builds and type checks passed in source and demo. Browser demo confirmed the empty dispatch state; populated-manifest selection, phone/tablet layout and end-to-end dispatch were not verified because no ready shipment was present. Remaining screens require individual UX updates.

## Trips UX

Trips & Drivers uses a searchable trip list and selected trip details, retaining pallet grouping and driver reassignment actions. Existing font/menu unchanged. Typecheck/build passed for both applications. Browser demo verified the empty state and planning dialog; there were no ready shipments to create a trip, so populated selection and reassignments remain unverified. Phone/tablet checks and end-to-end delivery tests were not run; other sections still need UX updates.

## Returns and review UX

Returns & Review uses a searchable issue list and selected issue details, preserving original-box, resolution and return inspection actions. Held stock rules and role checks are unchanged. Source and demo typecheck/build passed; synthetic browser verified the displayed issue and search empty state. Multi-issue selection, return disposition, phone/tablet and native PostgreSQL were not tested. Remaining sections need UX work.

## Documents UX

Documents & Labels provides a searchable document list with selected original and review panel. Full application keeps recognition panels mounted during selection to avoid discarding pending state; device-local demo still reports OCR unconfigured. Existing fonts/menu and stock behavior unchanged. Source/demo typecheck and build passed; browser demo verified empty state only. Populated document selection, OCR draft retention, upload and phone/tablet checks remain unverified. Remaining sections need UX work.

## Remaining task-screen improvements

Receiving requires an explicit physical condition instead of defaulting to good. Counting warns before clearing observations on a location change, rejects blank box IDs and distinguishes loaded expectations from an unknown unselected location. Driver view uses selectable shipment details and preserves handover status. Fonts and navigation are unchanged. `npm run verify` passed 90 tests with one native PostgreSQL test skipped; source/demo builds passed. Browser demo checked receiving condition, synthetic count recording, location-change warning and driver empty state. Populated driver workflow, phone/tablet visual checks, OCR/upload and exact per-screen visual fidelity remain unverified. The remaining mockup-specific layouts, full operational onboarding and production readiness are not claimed complete.

## Order entry, CSV mapping and scrollbar UX

Order entry supports filtering products by SKU and English/Chinese name while retaining selected lines, displays base units and inline positive decimal validation, and prompts staff to check destination authorisation after a customer change. Product CSV import can match exact unique canonical headers for human review; preview/commit and server validation remain separate. Scrollbar chrome is hidden without disabling overflow. Fonts and menu remain unchanged. `npm run verify` passed 90 tests with one PostgreSQL-only skip. Browser demo verified Chinese product filtering/unit, zero-quantity error and exact CSV mapping. The demo did not commit an import; phone/tablet scrolling, file chooser upload, complete order submission and native PostgreSQL remain unverified.

## Sign-out draft protection

Sign-out captures registered open forms before checking for unsynced device drafts, requests confirmation before clearing them, and preserves drafts if capture, draft lookup, confirmation or server sign-out fails. A cleanup failure after confirmed sign-out is reported separately. Existing navigation and styling are unchanged. `npm run verify`: 94 passed, 0 failed, one native PostgreSQL test skipped; typecheck/build passed. Unit tests exercise orchestration; browser sign-out and real device storage failures have not been tested. Offline automatic sync remains unimplemented.

## Pallet-group shipment review

Dispatch-authorized staff can request a bounded read-only review of the boxes on a group and see shipment, customer, destination, trip and load state. Multiple product lines in one shipment do not duplicate the box. Unassigned shipments, different trips and multiple active shipments are flagged. This is planning information and does not verify loading or dispatch. The first 200 boxes are shown with a truncation warning. `npm run verify`: 95 passed, one PostgreSQL-only test skipped; typecheck/build passed. Browser and physical-device checks not run. Native PostgreSQL concurrency remains unverified. The browser-local preview does not contain this new server-backed review.

## Pallet review pagination

The scoped read-only review now provides deterministic 200-box pages, next/previous and restart controls, and rejects invalid or stale membership cursors. Query caches include company/warehouse/user scope. Pages are live observations; box movements and shipment changes may occur between requests and do not create a frozen manifest. `npm run verify`: 96 passed, one native PostgreSQL-only skipped; typecheck/build passed. PGlite covers 205 boxes and stale/invalid/cross-warehouse cursors. Browser, physical device, native PostgreSQL, and hosted preview verification remain not run.

## Unconfirmed API response recovery

The full backend client now treats malformed/empty/non-JSON responses and non-contract error bodies as unconfirmed instead of assuming a definitive rejection. This preserves existing retry behavior in workflows that retain operation IDs. Network failures no longer assert that a device draft was saved. Structured server errors and successful JSON still propagate normally. Full suite: 100 passed, one PostgreSQL-only skipped; after a follow-up error-envelope change, focused response tests, typecheck and build passed. Browser/device and proxy end-to-end tests are not run; automatic sync is still unimplemented. The browser-local demo uses a different API client and is unchanged.

## Expected inbound candidate

The full application supports company-scoped supplier creation (configure permission), dated single-product expected receipts, and one physical box per receiving command. It tracks expected, received, outstanding and at-receipt accepted/held/pending quantities, enforces base units, blocks over-receipts, records immutable box links and audit events, and preserves operation IDs for retries. No stock is added by planning. Damaged boxes remain held when required traceability is missing; good boxes with missing traceability stay unconfirmed. Migration 014 is additive; logical backup format v6 includes inbound records. The receive UI includes scoped drafts. `npm run verify`: 101 passed, one native PostgreSQL-only skipped; typecheck/build passed. An intermediate run found an order-dependent worker test; that test now processes the target job deterministically and restores its test grant in a finally block. Browser, physical-device, native PostgreSQL migration/concurrency and live preview are not verified. One product per expectation; no expected-receipt edit/cancel, unexpected/over-receipt approval, multi-line PO, supplier returns, real supplier import or live disposition totals. Lists are capped at 200. This is not production-ready.

## Expected inbound cancellation

Supervisors/administrators can cancel an unreceived balance with a reason and expected version; the audited event preserves received boxes, their stock/holds and original receipt history. The list shows canceled quantity/reason and blocks further receipt. Exact operation replay is idempotent; database uniqueness enforces one cancellation. Full verify passed 101 tests with one native PostgreSQL-only skipped before the last read/display refinement; the focused inbound test, typecheck and build passed after it. Browser/device, native PostgreSQL migration and concurrency, and hosted preview remain unverified. This does not implement supplier returns, multi-line POs or unexpected deliveries.
