# PLATFORM-001 · audit and bounded upgrade

Base inspected: f03da2c. Source tree preserved; no real-company database reset or ownership reassignment. Candidate SHA is recorded in PLATFORM-SOURCE.txt. The final packaged-source clean extraction/check is recorded separately in package-verification.txt.

## Automated results

- PASSED: baseline reproduction, 47/47 tests, strict TypeScript and frontend build (platform-baseline.txt).
- PASSED: current suite 58 checks, 57 passed, 0 failed, 1 explicitly skipped; strict TypeScript and frontend build (platform-verification.txt).
- PASSED on PGlite/HTTP: cross-company references, authenticated read/mutation/workspace/export isolation, current worker/export permission, occupied/corrupt/incomplete restore protection, complete domain/private-file hash restore, quote-aware migrations, versioned authorized configuration/replay/conflicts, company-specific schedules without repeated orders, immutable history, policy snapshots and populated legacy/ambiguous migration rehearsal.
- BLOCKED: native PostgreSQL independent-client races and native restore. No native server/disposable source and restore URLs. Raw guard: postgresql-gate.txt. One native-only test is skipped, never counted as a pass.
- NOT RUN: full physical-device/camera certification, large-data performance, full retention/offboarding exercise, serial/variable-weight inventory and unimplemented modules.

## Browser · full Express backend with persistent development PGlite

PASSED desktop (26 October 2026): selected an actual 96×96 synthetic PNG via browser file chooser, preview appeared, receipt submitted, server produced BOX-1E4D582D, 6 piece PRD-001, RCV-01, customer Not assigned. Receipt and photo-attachment audit entries appeared. Image decoded at naturalWidth=96. Reloaded, found the same box in the register and reopened its decoded private image. This closes the prior browser photo-upload evidence gap for this browser, not all cameras/devices.

PASSED desktop company setup: reviewed the existing Wednesday template with a synthetic QA reason; success returned version 2, one reviewed step. Real readiness is not implied. UI remains explicit about incomplete onboarding.

PASSED representative phone width, actual 390×844 iframe: receipt and bottom navigation readable; created unknown-content BOX-CDABFF84 at RCV-01 without a guessed product/quantity; status stayed Unconfirmed. Opened movement task, moved it to HOLD-01 with a physical reason; details showed version 2 and immutable movement history. Controls and text fit inspected states. This is viewport emulation, not a physical device.

Tablet/settings and published demo checks are recorded below when completed. Browser failure history: one exact-label locator mismatch, then a quantity label changed after selecting a product; fresh DOM/AX inspection resolved both. No repeated tab loop. Photo file chooser succeeded on this run.

## Limits and next slice

Company-aware constraints strengthen the existing company partition. Users still have one company; memberships/switching and warehouse/stock-owner grants are not implemented. Company setup ships three real saved steps, not a ten-step placeholder. CSV/opening inventory, inbound tasks/transfers/traceability expansion, automatic offline sync and OCR remain absent/partial as mapped in PLATFORM-GAP-MATRIX.md. No production, native concurrency, universal warehouse or regulated-industry suitability claim.

Next: run native source/restore gates on isolated databases, implement company memberships/warehouse-access provisioning, then atomic CSV catalogue/opening reconciliation. Actual operational limits remain unconfirmed until supplied/configured.

PASSED representative tablet width, actual 768×1024 iframe: saved locale review using existing Europe/London/English/day-first values and a synthetic reason. UI returned version 3 and two reviewed steps. Step actions, explanatory limits, form and success state were readable in inspected screenshots. Physical-device/camera denial and all-screen certification remain NOT RUN.

PASSED clean package: extracted the code-candidate ZIP into a new directory, verified ZIP CRC/path safety and absence of runtime/node_modules/.env, ran documented npm ci (192 packages) and npm run verify. Result: 57 passed, 0 failed, one native-only skipped; TypeScript/build passed. Logs package-install.txt and package-verification.txt. Built frontend bounded scan found no SESSION_SECRET, ADMIN_PASSWORD, DATABASE_URL or private-key header markers; this is not universal secret detection.

Final handoff check: an additional fresh npm ci retry after the session restart was BLOCKED by registry.npmjs.org HTTP 403. The earlier clean npm ci and full verification of implementation 00c27c9 passed with the identical lockfile. Final source adds evidence and corrects one remaining generic overview heading; its extracted archive is verified using those existing dependency bytes. This is reported separately from the blocked latest network install.
