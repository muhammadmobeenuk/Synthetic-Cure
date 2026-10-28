import { randomUUID as uuid } from 'node:crypto';
import Decimal from 'decimal.js';
import type { DB } from '../database/index.js';
import { toteRegister, pickVerify } from '../contracts/picking.js';
import { authorize, owned, event, type Actor } from './services.js';
import { requireRule } from './index.js';

export async function registerTote(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'prepare');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = toteRegister.parse(payload);

  const existing = (
    await t.query(
      'SELECT * FROM picking_totes WHERE org_id=$1 AND warehouse_id=$2 AND code=$3',
      [a.org_id, a.warehouse_id, p.code],
    )
  ).rows[0];
  requireRule(!existing, 'TOTE_EXISTS', 'Tote code already exists in warehouse', 409);

  const id = uuid();
  await t.query(
    `INSERT INTO picking_totes(id, org_id, warehouse_id, code, status)
     VALUES($1, $2, $3, $4, 'available')`,
    [id, a.org_id, a.warehouse_id, p.code],
  );

  await event(t, a, id, 'picking.tote_registered', {
    code: p.code,
  });

  return owned(t, 'picking_totes', id, a);
}

export async function listTotes(t: DB, a: Actor) {
  authorize(a, 'review');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  return (
    await t.query(
      `SELECT * FROM picking_totes
       WHERE org_id=$1 AND warehouse_id=$2
       ORDER BY code ASC LIMIT 100`,
      [a.org_id, a.warehouse_id],
    )
  ).rows;
}

export async function verifyPickOperation(
  t: DB,
  a: Actor,
  payload: unknown,
) {
  authorize(a, 'prepare');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = pickVerify.parse(payload);

  const order = await owned(t, 'orders', p.orderId, a, true);
  const orderLine = await owned(t, 'order_lines', p.orderLineId, a, true);
  requireRule(orderLine.order_id === order.id, 'LINE_MISMATCH', 'Order line does not belong to order');

  const sourceLoc = await owned(t, 'locations', p.sourceLocationId, a);
  let toteId: string | null = null;

  if (p.toteId) {
    const tote = (
      await t.query(
        'SELECT * FROM picking_totes WHERE org_id=$1 AND warehouse_id=$2 AND id=$3 FOR UPDATE',
        [a.org_id, a.warehouse_id, p.toteId],
      )
    ).rows[0];
    requireRule(tote, 'TOTE_NOT_FOUND', 'Tote not found in warehouse', 404);
    requireRule(
      !tote.current_order_id || tote.current_order_id === order.id,
      'TOTE_IN_USE',
      'Tote is currently in use for another order',
      409,
    );
    toteId = tote.id;
    await t.query(
      "UPDATE picking_totes SET status='in_use', current_order_id=$1 WHERE id=$2",
      [order.id, tote.id],
    );
  } else if (p.toteCode) {
    const tote = (
      await t.query(
        'SELECT * FROM picking_totes WHERE org_id=$1 AND warehouse_id=$2 AND code=$3 FOR UPDATE',
        [a.org_id, a.warehouse_id, p.toteCode],
      )
    ).rows[0];
    requireRule(tote, 'TOTE_NOT_FOUND', 'Tote not found in warehouse', 404);
    requireRule(
      !tote.current_order_id || tote.current_order_id === order.id,
      'TOTE_IN_USE',
      'Tote is currently in use for another order',
      409,
    );
    toteId = tote.id;
    await t.query(
      "UPDATE picking_totes SET status='in_use', current_order_id=$1 WHERE id=$2",
      [order.id, tote.id],
    );
  }

  const scannedProduct = p.scannedProductId || p.productId;
  requireRule(scannedProduct, 'PRODUCT_REQUIRED', 'Product ID is required', 422);

  const isSubstitution = Boolean(p.isSubstitution);
  if (isSubstitution) {
    // Substitution requires supervisor authorization and valid reason
    authorize(a, 'adjust');
    requireRule(
      p.substitutedProductId && p.substitutedProductId !== orderLine.product_id,
      'SUBSTITUTION_MISMATCH',
      'Substituted product ID must be provided and differ from requested product',
      422,
    );
    requireRule(
      p.substitutionReason && p.substitutionReason.trim().length >= 3,
      'REASON_REQUIRED',
      'Record an authorized substitution reason',
      422,
    );

    const subProd = await owned(t, 'products', p.substitutedProductId, a);
    requireRule(
      subProd.unit === orderLine.unit,
      'UNIT_MISMATCH',
      'Substituted product unit must match order line base unit',
      422,
    );
  } else {
    // Direct pick without substitution: must match order line product
    requireRule(
      scannedProduct === orderLine.product_id,
      'PRODUCT_MISMATCH',
      `Scanned product does not match order line. Scanned ${scannedProduct}, expected ${orderLine.product_id}. Substitution authorization required.`,
      422,
    );
  }

  // Active quality quarantine hold check
  const pickTargetProduct = isSubstitution ? p.substitutedProductId! : orderLine.product_id;
  const holdRes = (
    await t.query(
      `SELECT id, reason FROM quality_holds
       WHERE org_id = $1 AND warehouse_id = $2 AND status = 'active'
         AND (
           (scope = 'product' AND target_id = $3) OR
           (scope = 'lot' AND target_id = $4) OR
           (scope = 'location' AND target_id = $5)
         )
       LIMIT 1`,
      [a.org_id, a.warehouse_id, pickTargetProduct, p.lotId || 'none', p.sourceLocationId],
    )
  ).rows[0];
  requireRule(!holdRes, 'QUALITY_HOLD', `Product or location is under active quality hold: ${holdRes?.reason}`, 422);

  const requestedQty = new Decimal(orderLine.quantity);
  const pickedQty = new Decimal(p.quantityPicked);
  requireRule(pickedQty.gte(0), 'INVALID_QUANTITY', 'Picked quantity cannot be negative');

  const shortageQty = Decimal.max(requestedQty.minus(pickedQty), 0);
  const status = isSubstitution
    ? 'substituted'
    : shortageQty.gt(0)
    ? 'shortage'
    : 'verified';

  const verificationId = uuid();
  await t.query(
    `INSERT INTO picking_verifications(
       id, org_id, warehouse_id, order_id, order_line_id, allocation_id, tote_id,
       source_location_id, product_id, lot_id, quantity_requested, quantity_picked,
       shortage_quantity, is_substitution, substituted_product_id, substitution_reason,
       authorized_by, status
     ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      verificationId,
      a.org_id,
      a.warehouse_id,
      order.id,
      orderLine.id,
      p.allocationId || null,
      toteId,
      sourceLoc.id,
      orderLine.product_id,
      p.lotId || null,
      requestedQty.toFixed(6),
      pickedQty.toFixed(6),
      shortageQty.toFixed(6),
      p.isSubstitution,
      p.isSubstitution ? p.substitutedProductId : null,
      p.isSubstitution ? p.substitutionReason : null,
      p.isSubstitution ? a.id : null,
      status,
    ],
  );

  await event(t, a, verificationId, 'pick.verified', {
    orderId: order.id,
    orderLineId: orderLine.id,
    requestedProductId: orderLine.product_id,
    scannedProductId: scannedProduct,
    isSubstitution: p.isSubstitution,
    substitutedProductId: p.isSubstitution ? p.substitutedProductId : null,
    substitutionReason: p.isSubstitution ? p.substitutionReason : null,
    quantityRequested: requestedQty.toFixed(6),
    quantityPicked: pickedQty.toFixed(6),
    shortageQuantity: shortageQty.toFixed(6),
    status,
    toteId,
  });

  return owned(t, 'picking_verifications', verificationId, a);
}

export async function listPickVerifications(t: DB, a: Actor, orderId: string) {
  authorize(a, 'review');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  return (
    await t.query(
      `SELECT pv.*,
              p1.sku requested_sku, p1.name requested_product_name,
              p2.sku substituted_sku, p2.name substituted_product_name,
              pt.code tote_code,
              sl.code source_location_code,
              u.name authorized_by_name
       FROM picking_verifications pv
       JOIN products p1 ON p1.id = pv.product_id AND p1.org_id = pv.org_id
       LEFT JOIN products p2 ON p2.id = pv.substituted_product_id AND p2.org_id = pv.org_id
       LEFT JOIN picking_totes pt ON pt.id = pv.tote_id
       JOIN locations sl ON sl.id = pv.source_location_id
       LEFT JOIN users u ON u.id = pv.authorized_by
       WHERE pv.org_id = $1 AND pv.warehouse_id = $2 AND pv.order_id = $3
       ORDER BY pv.created_at ASC`,
      [a.org_id, a.warehouse_id, orderId],
    )
  ).rows;
}
