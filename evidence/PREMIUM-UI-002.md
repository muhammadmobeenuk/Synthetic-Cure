# Orders, preparation and pallets layout candidate

PASSED: TypeScript and build; `npm run verify` backend and workflow tests 90 passed, 1 native PostgreSQL test skipped, 0 failures. The final search empty-state text was added while tests were in progress and separately typechecked and built. Desktop browser synthetic demo verified order search and selection, preparation selection and opening its existing confirmation dialog, pallet selection. No real stock was changed by these checks.

NOT RUN: phone/tablet layout checks, end-to-end stock-changing workflows for the new layouts, full per-screen visual comparison, native PostgreSQL. These three pages are redesigned; other sections still use their earlier layouts. Device-local demo is not an authenticated shared warehouse server.
