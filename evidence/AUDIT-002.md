# JadeSun audit candidate 002

## User-confirmed decisions
- Support whole-box/repack and loose-quantity picking.
- Configure food traceability per product. Actual requirements, limits and dates remain unconfirmed until entered from a verified source.
- Block ordinary dispatch for an unverified address, with an explicit supervisor exception and reason.

## Fixed findings
| Finding | Change | Regression evidence |
|---|---|---|
| New issues could leave previously checked goods loadable | Open issues invalidate readiness and loaded marks; dispatch revalidates current box issues/condition/data and preparation | Issue-after-check + direct-dispatch revalidation tests |
| Repeated scan could append another load event | Already-loaded box returns explicit duplicate/no-op without version/event/quantity change | Different-operation-ID duplicate scan test |
| Driver could receive stale-version metadata before assignment check or replay after reassignment | Object assignment checked before version state and before idempotent response replay | Actual HTTP reassignment/replay denial test |
| Verified quantity could be changed without a reason | Authorized correction requires a reason and retains previous contents in an immutable event | Operator denial, missing reason, before/after evidence test |
| Stop order followed UUID sorting rather than selected shipment sequence | Preserve explicit selection order | Stop-order regression test |
| Unverified destination lacked normal verification workflow | Versioned address verification with evidence; ordinary dispatch block; authorized audited exception | Address verification and dispatch override tests |
| Loose picking was missing | Transactional source-to-order-container transfer, reusable same-product/batch container, picked/reserved quantities, stable identities, known-empty source status | Repeat/replay, exact quantity conservation, overpick rollback, empty-source tests |
| Per-product tracking configuration was missing | Verified batch/expiry/temperature requirements and optional actual temperature range; missing data stays unconfirmed and cannot allocate/dispatch | Role, missing-field, outside-range and corrected-measurement tests |
| Multi-line confirmation UI was missing | Review preserves every contents line, batch and measured temperature; quantity corrections retain source evidence | Browser inspection plus existing API contracts and correction regressions |
| Stale form recovery was weak | Refresh authoritative records on 409; retain pending form input in current workspace memory until success | Typechecked UI implementation; reload intentionally clears unsaved memory |

## Verification
- PASSED: `npm run verify`: strict TypeScript, **47 tests**, frontend production build. Actual run completed with 47 passed, 0 failed, 0 skipped.
- PASSED: hosted-demo TypeScript check after synchronizing shared schemas, migrations, domain rules and command handlers.
- Browser checks and publication results are recorded in STATE.md after completion.
- BLOCKED: native PostgreSQL multi-client and native restore proof (no native database available).
- NOT RUN: full automated offline outbox/service-worker shell; these remain unimplemented and are not represented as synced work.

The previous candidate's 35-test evidence is historical. This report supersedes its implemented-feature and current-test-count summary. No real customer photos or real stock data were used.

Additional gap fixed: a physical box with entirely unidentified contents can now be received and photographed as Unconfirmed, with zero identified content lines. This is distinct from a known Empty container. Idempotent receipt regression passed. The box-details action can subsequently identify its contents without inventing a quantity.

Browser verification: desktop traceability form and loose picking exercised with synthetic records; ORD-001 showed 3 piece allocated/picked and 0 shipped in a new picking container. Representative Products screens inspected at actual 390×844 and 768×1024 iframe viewports; phone dialog actions reachable by keyboard and scrolling. A mobile header overflow risk was removed by hiding the redundant breadcrumb on narrow screens. These are browser viewport checks, not physical phone/camera certification or a complete end-to-end pass for every screen.
