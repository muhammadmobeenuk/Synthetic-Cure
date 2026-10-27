# Pallet-group shipment review

Candidate: source change for pallet-group shipment review (see git commit).

PASSED: npm run verify — 95 passed, zero failed, one native PostgreSQL-only test skipped; TypeScript and Vite build passed. PGlite tests exercised matching and different trips, unassigned/missing shipment, multiple active shipments, multiple lines per box, all-lines-loaded semantics, removed membership, cross-warehouse rejection and operator 403.

BLOCKED: Native PostgreSQL race/integration proof; no disposable native database provided. No production claim.

NOT RUN: browser UI with populated groups, device layouts, 200-box truncation UI, deployed live preview. The result can become stale and is a planning review, not a shipment load command or dispatch approval. First 200 boxes only; no pagination yet. The aggregate query and UI use no synthetic capacity or destination assumptions.
