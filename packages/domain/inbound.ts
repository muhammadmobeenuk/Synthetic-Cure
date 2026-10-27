import { randomUUID as uuid } from 'node:crypto';
import Decimal from 'decimal.js';
import type { DB } from '../database/index.js';
import {
  supplierCreate,
  expectedCreate,
  expectedReceive,
  expectedCancel,
  purchaseOrderCreate,
  purchaseOrderReceive,
  purchaseOrderCancel,
  discrepancyReport,
  discrepancyReview,
  supplierReturnCreate,
  supplierReturnAuthorize,
  supplierReturnDispatch,
} from '../contracts/inbound.js';
import { authorize, owned, version, event, services, type Actor } from './services.js';
import { requireRule, DomainError } from './index.js';

export async function inboundList(t: DB, a: Actor) {
  authorize(a, 'receive');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const suppliers = (
    await t.query(
      'SELECT id,code,name FROM suppliers WHERE org_id=$1 ORDER BY code,id LIMIT 200',
      [a.org_id],
    )
  ).rows;
  const expectations = (
    await t.query(
      `SELECT e.*,s.code supplier_code,s.name supplier_name,p.sku,p.name product_name,p.name_zh,
  COALESCE(SUM(r.quantity),0)::text received,
  COALESCE(SUM(r.quantity) FILTER (WHERE r.receipt_state='accepted'),0)::text accepted,
  COALESCE(SUM(r.quantity) FILTER (WHERE r.receipt_state='held'),0)::text held,
  COALESCE(SUM(r.quantity) FILTER (WHERE r.receipt_state='pending'),0)::text pending,
  EXISTS(SELECT 1 FROM inventory_events ev WHERE ev.org_id=e.org_id AND ev.warehouse_id=e.warehouse_id AND ev.entity_id=e.id AND ev.kind='inbound.expectation_cancelled') AS cancelled,
  (SELECT ev.data->>'reason' FROM inventory_events ev WHERE ev.org_id=e.org_id AND ev.warehouse_id=e.warehouse_id AND ev.entity_id=e.id AND ev.kind='inbound.expectation_cancelled') AS cancellation_reason
  FROM expected_receipts e JOIN suppliers s ON s.id=e.supplier_id AND s.org_id=e.org_id JOIN products p ON p.id=e.product_id AND p.org_id=e.org_id
  LEFT JOIN expected_receipt_boxes r ON r.expected_receipt_id=e.id AND r.org_id=e.org_id AND r.warehouse_id=e.warehouse_id
  WHERE e.org_id=$1 AND e.warehouse_id=$2 GROUP BY e.id,s.code,s.name,p.sku,p.name,p.name_zh ORDER BY e.created_at DESC,e.id DESC LIMIT 200`,
      [a.org_id, a.warehouse_id],
    )
  ).rows;
  return {
    suppliers,
    expectations: expectations.map((e) => {
      const remaining = new Decimal(e.quantity).minus(e.received).toFixed();
      return {
        ...e,
        outstanding: e.cancelled ? '0' : remaining,
        cancelled_quantity: e.cancelled ? remaining : '0',
      };
    }),
    limit: 200,
  };
}

export async function createSupplier(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'configure');
  const p = supplierCreate.parse(payload);
  const existing = (
    await t.query('SELECT id FROM suppliers WHERE org_id=$1 AND code=$2', [
      a.org_id,
      p.code,
    ])
  ).rows[0];
  requireRule(!existing, 'DUPLICATE_SUPPLIER', 'Supplier code already exists', 409);
  const id = uuid();
  const inserted = await t.query(
    'INSERT INTO suppliers(id,org_id,code,name) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,code) DO NOTHING RETURNING id',
    [id, a.org_id, p.code, p.name],
  );
  requireRule(
    inserted.rows.length,
    'DUPLICATE_SUPPLIER',
    'Supplier code already exists',
    409,
  );
  await event(t, a, id, 'supplier.created', { code: p.code });
  return { id, code: p.code, name: p.name };
}

export async function createExpectedReceipt(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'receive');
  const p = expectedCreate.parse(payload);
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  await owned(t, 'suppliers', p.supplierId, a);
  const product = await owned(t, 'products', p.productId, a);
  requireRule(product.unit === p.unit, 'UNIT_MISMATCH', 'Use the product base unit');
  const id = uuid();
  await t.query(
    'INSERT INTO expected_receipts(id,org_id,warehouse_id,supplier_id,product_id,reference,expected_date,quantity,unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      id,
      a.org_id,
      a.warehouse_id,
      p.supplierId,
      p.productId,
      p.reference,
      p.expectedDate,
      p.quantity,
      p.unit,
    ],
  );
  await event(t, a, id, 'inbound.expected', {
    supplierId: p.supplierId,
    productId: p.productId,
    reference: p.reference,
    expectedDate: p.expectedDate,
    quantity: p.quantity,
    unit: p.unit,
  });
  return owned(t, 'expected_receipts', id, a);
}

export async function receiveExpectedBox(t: DB, a: Actor, id: string, payload: unknown) {
  authorize(a, 'receive');
  const p = expectedReceive.parse(payload);
  const expected = await owned(t, 'expected_receipts', id, a, true);
  version(expected, p.expectedVersion);
  requireRule(
    !(
      await t.query(
        "SELECT id FROM inventory_events WHERE org_id=$1 AND warehouse_id=$2 AND entity_id=$3 AND kind='inbound.expectation_cancelled'",
        [a.org_id, a.warehouse_id, id],
      )
    ).rows.length,
    'EXPECTED_CANCELLED',
    'This expectation was canceled and cannot receive more boxes',
    409,
  );
  const total = (
    await t.query(
      'SELECT COALESCE(SUM(quantity),0)::text total FROM expected_receipt_boxes WHERE expected_receipt_id=$1 AND org_id=$2 AND warehouse_id=$3',
      [id, a.org_id, a.warehouse_id],
    )
  ).rows[0].total;
  requireRule(
    new Decimal(total).plus(p.quantity).lte(expected.quantity),
    'OVER_RECEIPT',
    'Quantity exceeds the outstanding expected amount. Record an exception for review.',
    409,
  );
  const box = await services.receipt(t, a, {
    customerId: null,
    locationId: p.locationId,
    sourceLabel: p.sourceLabel,
    condition: p.condition,
    contents: [
      {
        productId: expected.product_id,
        quantity: p.quantity,
        unit: expected.unit,
        verified: true,
      },
    ],
  });
  const state =
    box.status === 'hold' ? 'held' : box.status === 'confirmed' ? 'accepted' : 'pending';
  await t.query(
    'INSERT INTO expected_receipt_boxes(id,org_id,warehouse_id,expected_receipt_id,box_id,quantity,unit,receipt_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [uuid(), a.org_id, a.warehouse_id, id, box.id, p.quantity, expected.unit, state],
  );
  await t.query('UPDATE expected_receipts SET version=version+1 WHERE id=$1', [id]);
  await event(t, a, id, 'inbound.box_received', {
    boxId: box.id,
    quantity: p.quantity,
    unit: expected.unit,
    receiptState: state,
  });
  return { box, expected: await owned(t, 'expected_receipts', id, a) };
}

export async function cancelExpectedReceipt(t: DB, a: Actor, id: string, payload: unknown) {
  authorize(a, 'adjust');
  const p = expectedCancel.parse(payload);
  const expected = await owned(t, 'expected_receipts', id, a, true);
  version(expected, p.expectedVersion);
  requireRule(
    !(
      await t.query(
        "SELECT id FROM inventory_events WHERE org_id=$1 AND warehouse_id=$2 AND entity_id=$3 AND kind='inbound.expectation_cancelled'",
        [a.org_id, a.warehouse_id, id],
      )
    ).rows.length,
    'EXPECTED_CANCELLED',
    'This expectation is already canceled',
    409,
  );
  const received = (
    await t.query(
      'SELECT COALESCE(SUM(quantity),0)::text total FROM expected_receipt_boxes WHERE expected_receipt_id=$1 AND org_id=$2 AND warehouse_id=$3',
      [id, a.org_id, a.warehouse_id],
    )
  ).rows[0].total;
  const remaining = new Decimal(expected.quantity).minus(received);
  requireRule(
    remaining.gt(0),
    'EXPECTED_COMPLETE',
    'This expectation has no outstanding quantity to cancel',
    409,
  );
  await t.query('UPDATE expected_receipts SET version=version+1 WHERE id=$1', [id]);
  await event(t, a, id, 'inbound.expectation_cancelled', {
    reason: p.reason,
    cancelledQuantity: remaining.toFixed(),
    unit: expected.unit,
    receivedQuantity: received,
  });
  return {
    ...(await owned(t, 'expected_receipts', id, a)),
    cancelled: true,
    cancelledQuantity: remaining.toFixed(),
  };
}

// ----------------- Multi-line Purchase Orders -----------------
export async function listPurchaseOrders(t: DB, a: Actor) {
  authorize(a, 'receive');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const pos = (
    await t.query(
      `SELECT po.*, s.code supplier_code, s.name supplier_name,
       (SELECT count(*)::int FROM purchase_order_lines pol WHERE pol.purchase_order_id=po.id) line_count,
       (SELECT COALESCE(sum(pol.expected_quantity), 0)::text FROM purchase_order_lines pol WHERE pol.purchase_order_id=po.id) total_expected,
       (SELECT COALESCE(sum(pol.received_quantity), 0)::text FROM purchase_order_lines pol WHERE pol.purchase_order_id=po.id) total_received
       FROM purchase_orders po
       JOIN suppliers s ON s.id=po.supplier_id AND s.org_id=po.org_id
       WHERE po.org_id=$1 AND po.warehouse_id=$2
       ORDER BY po.created_at DESC, po.id DESC LIMIT 100`,
      [a.org_id, a.warehouse_id],
    )
  ).rows;
  return pos;
}

export async function getPurchaseOrder(t: DB, a: Actor, id: string) {
  authorize(a, 'receive');
  const po = await owned(t, 'purchase_orders', id, a);
  const lines = (
    await t.query(
      `SELECT pol.*, p.sku, p.name product_name, p.name_zh,
       (pol.expected_quantity - pol.received_quantity)::text remaining_balance
       FROM purchase_order_lines pol
       JOIN products p ON p.id=pol.product_id AND p.org_id=pol.org_id
       WHERE pol.purchase_order_id=$1 AND pol.org_id=$2
       ORDER BY pol.line_number`,
      [id, a.org_id],
    )
  ).rows;
  const supplier = await owned(t, 'suppliers', po.supplier_id, a);
  return { ...po, supplier, lines };
}

export async function createPurchaseOrder(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'receive');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = purchaseOrderCreate.parse(payload);
  await owned(t, 'suppliers', p.supplierId, a);

  // Check unique PO number in warehouse
  const existing = (
    await t.query(
      'SELECT id FROM purchase_orders WHERE org_id=$1 AND warehouse_id=$2 AND po_number=$3',
      [a.org_id, a.warehouse_id, p.poNumber],
    )
  ).rows[0];
  requireRule(!existing, 'DUPLICATE_PO', 'PO number already exists in warehouse', 409);

  // Validate all line products and units
  for (const l of p.lines) {
    const prod = await owned(t, 'products', l.productId, a);
    requireRule(
      prod.unit === l.unit,
      'UNIT_MISMATCH',
      `Product ${prod.sku} must use base unit ${prod.unit}`,
      422,
    );
  }

  const poId = uuid();
  await t.query(
    `INSERT INTO purchase_orders(id, org_id, warehouse_id, supplier_id, po_number, supplier_reference, expected_date, status, version)
     VALUES($1, $2, $3, $4, $5, $6, $7, 'open', 1)`,
    [
      poId,
      a.org_id,
      a.warehouse_id,
      p.supplierId,
      p.poNumber,
      p.supplierReference,
      p.expectedDate,
    ],
  );

  let lineNum = 1;
  for (const l of p.lines) {
    const lineId = uuid();
    await t.query(
      `INSERT INTO purchase_order_lines(id, org_id, warehouse_id, purchase_order_id, line_number, product_id, expected_quantity, unit, received_quantity, status, version)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, 0, 'open', 1)`,
      [
        lineId,
        a.org_id,
        a.warehouse_id,
        poId,
        lineNum++,
        l.productId,
        l.expectedQuantity,
        l.unit,
      ],
    );
  }

  await event(t, a, poId, 'purchase_order.created', {
    poNumber: p.poNumber,
    supplierId: p.supplierId,
    supplierReference: p.supplierReference,
    lineCount: p.lines.length,
  });

  return getPurchaseOrder(t, a, poId);
}

export async function receivePurchaseOrderLine(
  t: DB,
  a: Actor,
  poId: string,
  payload: unknown,
) {
  authorize(a, 'receive');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = purchaseOrderReceive.parse(payload);
  const po = await owned(t, 'purchase_orders', poId, a, true);
  version(po, p.expectedVersion);
  requireRule(po.status !== 'cancelled', 'PO_CANCELLED', 'Cannot receive on a cancelled PO', 409);

  const lineRes = await t.query(
    'SELECT * FROM purchase_order_lines WHERE id=$1 AND purchase_order_id=$2 AND org_id=$3 AND warehouse_id=$4 FOR UPDATE',
    [p.lineId, poId, a.org_id, a.warehouse_id],
  );
  const line = lineRes.rows[0];
  requireRule(line, 'NOT_FOUND', 'Purchase order line not found', 404);

  const curReceived = new Decimal(line.received_quantity);
  const expQty = new Decimal(line.expected_quantity);
  const rcvQty = new Decimal(p.quantity);
  const newReceived = curReceived.plus(rcvQty);

  requireRule(
    newReceived.lte(expQty),
    'OVER_RECEIPT',
    'Received quantity exceeds remaining line expectation. Record an inbound discrepancy for supervisor review.',
    409,
  );

  // Receive physical box
  const box = await services.receipt(t, a, {
    customerId: null,
    locationId: p.locationId,
    sourceLabel: p.sourceLabel,
    condition: p.condition,
    contents: [
      {
        productId: line.product_id,
        quantity: p.quantity,
        unit: line.unit,
        verified: true,
      },
    ],
  });

  const nextLineStatus = newReceived.equals(expQty) ? 'received' : 'partially_received';
  await t.query(
    'UPDATE purchase_order_lines SET received_quantity=$1, status=$2, version=version+1 WHERE id=$3',
    [newReceived.toFixed(6), nextLineStatus, line.id],
  );

  // Re-check all lines status for PO
  const allLines = (
    await t.query(
      'SELECT status FROM purchase_order_lines WHERE purchase_order_id=$1',
      [poId],
    )
  ).rows;
  const allReceived = allLines.every((l) => l.status === 'received');
  const poNextStatus = allReceived ? 'received' : 'partially_received';

  await t.query(
    'UPDATE purchase_orders SET status=$1, version=version+1 WHERE id=$2',
    [poNextStatus, poId],
  );

  await event(t, a, poId, 'purchase_order.line_received', {
    lineId: line.id,
    boxId: box.id,
    quantity: p.quantity,
    unit: line.unit,
    condition: p.condition,
    poStatus: poNextStatus,
  });

  return { box, purchaseOrder: await getPurchaseOrder(t, a, poId) };
}

export async function cancelPurchaseOrder(
  t: DB,
  a: Actor,
  id: string,
  payload: unknown,
) {
  authorize(a, 'adjust');
  const p = purchaseOrderCancel.parse(payload);
  const po = await owned(t, 'purchase_orders', id, a, true);
  version(po, p.expectedVersion);
  requireRule(po.status !== 'cancelled', 'PO_CANCELLED', 'Purchase order is already cancelled', 409);
  requireRule(po.status !== 'received', 'PO_RECEIVED', 'Fully received PO cannot be cancelled', 409);

  await t.query(
    "UPDATE purchase_orders SET status='cancelled', version=version+1 WHERE id=$1",
    [id],
  );
  await t.query(
    "UPDATE purchase_order_lines SET status='cancelled', version=version+1 WHERE purchase_order_id=$1 AND status<>'received'",
    [id],
  );

  await event(t, a, id, 'purchase_order.cancelled', {
    reason: p.reason,
    previousStatus: po.status,
  });

  return getPurchaseOrder(t, a, id);
}

// ----------------- Unexpected, Over, Short & Damaged Delivery -----------------
export async function reportDiscrepancy(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'receive');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = discrepancyReport.parse(payload);
  const prod = await owned(t, 'products', p.productId, a);

  if (p.purchaseOrderId) await owned(t, 'purchase_orders', p.purchaseOrderId, a);
  if (p.expectedReceiptId) await owned(t, 'expected_receipts', p.expectedReceiptId, a);

  const id = uuid();
  await t.query(
    `INSERT INTO inbound_discrepancies(id, org_id, warehouse_id, purchase_order_id, po_line_id, expected_receipt_id, product_id, kind, reported_quantity, unit, evidence, status, version)
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', 1)`,
    [
      id,
      a.org_id,
      a.warehouse_id,
      p.purchaseOrderId || null,
      p.poLineId || null,
      p.expectedReceiptId || null,
      prod.id,
      p.kind,
      p.reportedQuantity,
      p.unit,
      p.evidence,
    ],
  );

  await event(t, a, id, 'inbound.discrepancy_reported', {
    kind: p.kind,
    reportedQuantity: p.reportedQuantity,
    unit: p.unit,
    evidence: p.evidence,
    purchaseOrderId: p.purchaseOrderId,
    productId: prod.id,
  });

  return owned(t, 'inbound_discrepancies', id, a);
}

export async function listDiscrepancies(t: DB, a: Actor, status?: string) {
  authorize(a, 'review');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  let sql = `
    SELECT d.*, p.sku, p.name product_name, p.name_zh, u.name reviewer_name
    FROM inbound_discrepancies d
    JOIN products p ON p.id = d.product_id AND p.org_id = d.org_id
    LEFT JOIN users u ON u.id = d.reviewed_by
    WHERE d.org_id = $1 AND d.warehouse_id = $2
  `;
  const params: any[] = [a.org_id, a.warehouse_id];
  if (status) {
    params.push(status);
    sql += ` AND d.status = $${params.length}`;
  }
  sql += ' ORDER BY d.created_at DESC, d.id DESC LIMIT 100';
  return (await t.query(sql, params)).rows;
}

export async function reviewDiscrepancy(
  t: DB,
  a: Actor,
  id: string,
  payload: unknown,
) {
  authorize(a, 'adjust');
  const p = discrepancyReview.parse(payload);
  const disc = await owned(t, 'inbound_discrepancies', id, a, true);
  version(disc, p.expectedVersion);
  requireRule(disc.status === 'pending', 'DISCREPANCY_ALREADY_REVIEWED', 'Discrepancy is already reviewed', 409);

  const nextStatus = p.approved ? 'approved' : 'rejected';
  await t.query(
    `UPDATE inbound_discrepancies
     SET status=$1, disposition=$2, reviewed_by=$3, reviewed_at=now(), review_notes=$4, version=version+1
     WHERE id=$5`,
    [nextStatus, p.disposition, a.id, p.notes, id],
  );

  await event(t, a, id, 'inbound.discrepancy_reviewed', {
    status: nextStatus,
    disposition: p.disposition,
    notes: p.notes,
  });

  return owned(t, 'inbound_discrepancies', id, a);
}

// ----------------- Supplier Returns -----------------
export async function listSupplierReturns(t: DB, a: Actor) {
  authorize(a, 'review');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const rows = (
    await t.query(
      `SELECT sr.*, s.code supplier_code, s.name supplier_name, p.sku, p.name product_name, u.name authorizer_name
       FROM supplier_returns sr
       JOIN suppliers s ON s.id=sr.supplier_id AND s.org_id=sr.org_id
       JOIN products p ON p.id=sr.product_id AND p.org_id=sr.org_id
       LEFT JOIN users u ON u.id=sr.authorized_by
       WHERE sr.org_id=$1 AND sr.warehouse_id=$2
       ORDER BY sr.created_at DESC, sr.id DESC LIMIT 100`,
      [a.org_id, a.warehouse_id],
    )
  ).rows;
  return rows;
}

export async function createSupplierReturn(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'adjust');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = supplierReturnCreate.parse(payload);
  const supp = await owned(t, 'suppliers', p.supplierId, a);
  const prod = await owned(t, 'products', p.productId, a);

  if (p.boxId) {
    const box = await owned(t, 'boxes', p.boxId, a);
    requireRule(
      box.condition === 'hold' || box.status === 'hold',
      'BOX_NOT_HELD',
      'Only held boxes may be targeted for supplier return',
      422,
    );
  }

  const id = uuid();
  await t.query(
    `INSERT INTO supplier_returns(id, org_id, warehouse_id, supplier_id, discrepancy_id, product_id, box_id, quantity, unit, reason, status, version)
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'held', 1)`,
    [
      id,
      a.org_id,
      a.warehouse_id,
      supp.id,
      p.discrepancyId || null,
      prod.id,
      p.boxId || null,
      p.quantity,
      p.unit,
      p.reason,
    ],
  );

  await event(t, a, id, 'supplier_return.created', {
    supplierId: supp.id,
    productId: prod.id,
    quantity: p.quantity,
    unit: p.unit,
    reason: p.reason,
  });

  return owned(t, 'supplier_returns', id, a);
}

export async function authorizeSupplierReturn(
  t: DB,
  a: Actor,
  id: string,
  payload: unknown,
) {
  authorize(a, 'adjust');
  const p = supplierReturnAuthorize.parse(payload);
  const ret = await owned(t, 'supplier_returns', id, a, true);
  version(ret, p.expectedVersion);
  requireRule(ret.status === 'held', 'INVALID_STATE', 'Only held returns can be authorized', 409);

  await t.query(
    `UPDATE supplier_returns
     SET status='authorized', authorized_by=$1, authorized_at=now(), version=version+1
     WHERE id=$2`,
    [a.id, id],
  );

  await event(t, a, id, 'supplier_return.authorized', {
    notes: p.notes,
  });

  return owned(t, 'supplier_returns', id, a);
}

export async function dispatchSupplierReturn(
  t: DB,
  a: Actor,
  id: string,
  payload: unknown,
) {
  authorize(a, 'dispatch');
  const p = supplierReturnDispatch.parse(payload);
  const ret = await owned(t, 'supplier_returns', id, a, true);
  version(ret, p.expectedVersion);
  requireRule(
    ret.status === 'authorized',
    'NOT_AUTHORIZED',
    'Supplier return must be authorized before dispatch',
    409,
  );

  // If a box is attached, mark the box returned/dispatched to supplier
  if (ret.box_id) {
    await t.query(
      "UPDATE boxes SET status='returned', condition='damaged', version=version+1 WHERE id=$1",
      [ret.box_id],
    );
  }

  await t.query(
    `UPDATE supplier_returns
     SET status='dispatched', outbound_tracking=$1, version=version+1
     WHERE id=$2`,
    [p.outboundTracking, id],
  );

  await event(t, a, id, 'supplier_return.dispatched', {
    outboundTracking: p.outboundTracking,
    notes: p.notes,
    boxId: ret.box_id,
    quantity: ret.quantity,
    unit: ret.unit,
  });

  return owned(t, 'supplier_returns', id, a);
}
