# Staff onboarding guide

## Synthetic evaluation

Run `npm ci` then `npm run dev`, open http://localhost:3000 and choose Enter demo workspace. The data is synthetic and persists in this local development database. Never load real customer files into a public demo.

An administrator opens Settings → Company setup and reviews identity, locale and preparation days. Each step saves independently with a reason. The progress survives reload. A version conflict keeps your entered work and shows current settings for explicit reconciliation. An operator can read the settings but cannot change them.

For JadeSun, confirm Europe/London and Wednesday preparation from the known business brief. Preparation and delivery remain separate. Another company chooses its own days or ad-hoc preparation.

Receive & scan → choose a physical location → capture original label text → enter product/quantity/unit (or mark contents unidentified) → physically verify → attach a supported photo → Confirm & receive box. Open the resulting internal box ID, verify location/content/photo and history. A failed photo attachment keeps the received box and offers retry; never receive it again just to retry a photo.

Order preparation uses existing internal customer orders. Allocate whole boxes, or start Picking and transfer a loose quantity into an identified order container. The board tracks picking, packing, checking and readiness. Goods must physically be at staging before Ready. No orders repeat each week.

For delivery, plan a trip/date/driver separately, verify the manifest, load identified boxes, dispatch with server confirmation, then record final handover at the assigned stop. Loading is not delivery. Returned goods remain held until disposition.

## Before live staff work

Complete operational onboarding beyond the three configuration steps: approved staff/warehouse permissions, real locations, verified product units/handling rules, safe opening-stock reconciliation, private storage and PostgreSQL recovery gates. Refer to READINESS.md. The demo role selector is not live authentication.

Device drafts are provisional and company/user scoped. Existing legacy user drafts remain recoverable for the same one-company identity. Signing out warns if saved drafts exist and clears them only after successful server logout. Automatic sync is not implemented.

## Company and warehouse access
Settings → Company & warehouse opens assigned contexts. Administrators use Staff & warehouse access to create/review warehouses, update existing staff memberships and assign/revoke grants with reasons. A new additional membership has no warehouse access until explicitly assigned. Existing home namespace grants are compatibility backfills, not validated physical warehouse identities. Save drafts before closing a browser; app navigation/context changes preserve active receipt/count captures. Native PostgreSQL and real staff policy approval remain required before live rollout.

## Import a product catalogue
1. Products & batches → Open importer (administrator).
2. Upload UTF-8 comma CSV or paste it. Include a header; use supported profile/unit values shown on screen.
3. Select each required source column and any optional Chinese/handling column. Leave unknown fields unmapped. Enter the source/reason.
4. Save validation preview. Review every row and ignored columns. Download errors and correct the source; no products/stock exist yet.
5. Commit only a valid reviewed batch. Reload and reopen the saved batch to inspect its recorded product identities.
6. Opening inventory is not part of product import. Complete a separate cut-over/reconciliation process before claiming a warehouse is ready.
