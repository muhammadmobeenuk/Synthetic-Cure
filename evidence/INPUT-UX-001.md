# Input UX verification

PASSED: `npm run verify` (90 passed, 0 failed, 1 PostgreSQL-only skipped); synthetic browser product filtering by Chinese name, selected base unit, zero-quantity inline error, CSV exact-header mapping with no product commit.

NOT RUN: phone/tablet scrolling, file chooser import, complete order submission for this slice, native PostgreSQL. Scrollbars are visually hidden but scrolling is not disabled. OCR and other imports remain unchanged.
