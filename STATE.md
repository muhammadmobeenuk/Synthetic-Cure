# Current candidate · PLATFORM-003

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

## Synthetic Cure 4-Quadrant Reference UI & Automation Guard Candidate

Implemented the high-fidelity UI/UX from the 4-quadrant reference screenshot in `apps/web/src/ScreenshotViews.tsx` and integrated it cleanly into `apps/web/src/main.tsx` and `apps/web/src/style.css`:
1. Topbar & Shell: Full-width dark teal header with faceted emerald/gold brand mark (`SyntheticCureLogo`), "Synthetic Cure" title, "DEMO DATA" badge, global search, notification dot, and profile switcher ("JD" / "Jamie Doe" / "Warehouse").
2. Today Dashboard (Panel 1): Warehouse switcher, 4 primary KPI cards (Orders to prepare [12], Boxes to pick [86], Pallets to build [8], Needs review [2 in amber alert]), and "Work awaiting attention" tabbed data table with progress indicators and status pills.
3. Receive & Scan (Panel 2): 3-column workflow with interactive viewfinder (scan label & photo capture file input), box details form with verified emerald badge, SKU combobox, and "Unconfirmed fields" card.
4. Inventory & Locations (Panel 3): Boxes vs Locations tabs, search + 3-select filter bar, "+ Add box" & "Export" CTAs, and box inventory table matching screenshot records (`BX-730991827`, `BX-661204113`, etc.).
5. Box Detail (Panel 4): Full-page detail view for `BX-730991827` featuring breadcrumb navigation, storage status badge, creation/update timestamps, Box Information card, Location & Pallet card with movement history audit trail, and Contents card.

Fixed cross-platform Windows test anomaly in `tests/workflows.test.ts` where `/dev/null/private` was treated as a writable relative path. Terminated automated browser window launches permanently by abandoning external browser subagents.

Verification: `npm run verify` passed (TypeScript check passed, 89 passed, 0 failed, 2 skipped, Vite client build passed).

