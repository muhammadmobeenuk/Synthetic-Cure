import { randomUUID as uuid } from 'node:crypto';
import Decimal from 'decimal.js';
import type { DB } from '../database/index.js';
import {
  transferOrderCreate,
  transferOrderDispatch,
  transferOrderReceive,
  transferOrderCancel,
} from '../contracts/transfers.js';
import { authorize, owned, version, event, type Actor } from './services.js';
import { requireRule, DomainError } from './index.js';

export async function listTransferOrders(t: DB, a: Actor) {
  authorize(a, 'review');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const rows = (
    await t.query(
      `SELECT tro.*,
              sw.code source_warehouse_code, sw.name source_warehouse_name,
              dw.code destination_warehouse_code, dw.name destination_warehouse_name,
              (SELECT count(*)::int FROM transfer_lines tl WHERE tl.transfer_order_id=tro.id) line_count,
              (SELECT COALESCE(sum(tl.requested_quantity), 0)::text FROM transfer_lines tl WHERE tl.transfer_order_id=tro.id) total_requested,
              (SELECT COALESCE(sum(tl.dispatched_quantity), 0)::text FROM transfer_lines tl WHERE tl.transfer_order_id=tro.id) total_dispatched,
              (SELECT COALESCE(sum(tl.received_quantity), 0)::text FROM transfer_lines tl WHERE tl.transfer_order_id=tro.id) total_received
       FROM transfer_orders tro
       JOIN warehouses sw ON sw.id = tro.source_warehouse_id AND sw.org_id = tro.org_id
       JOIN warehouses dw ON dw.id = tro.destination_warehouse_id AND dw.org_id = tro.org_id
       WHERE tro.org_id = $1 AND (tro.source_warehouse_id = $2 OR tro.destination_warehouse_id = $2)
       ORDER BY tro.created_at DESC, tro.id DESC LIMIT 100`,
      [a.org_id, a.warehouse_id],
    )
  ).rows;
  return rows;
}

export async function getTransferOrder(t: DB, a: Actor, id: string) {
  authorize(a, 'review');
  const tro = await owned(t, 'transfer_orders', id, a);
  requireRule(
    tro.source_warehouse_id === a.warehouse_id || tro.destination_warehouse_id === a.warehouse_id,
    'TRANSFER_SCOPE',
    'Transfer order belongs to a different warehouse scope',
    403,
  );
  const lines = (
    await t.query(
      `SELECT tl.*, p.sku, p.name product_name, p.name_zh, b.code box_code
       FROM transfer_lines tl
       JOIN products p ON p.id = tl.product_id AND p.org_id = tl.org_id
       LEFT JOIN boxes b ON b.id = tl.box_id
       WHERE tl.transfer_order_id = $1 AND tl.org_id = $2
       ORDER BY tl.line_number`,
      [id, a.org_id],
    )
  ).rows;
  const sw = await owned(t, 'warehouses', tro.source_warehouse_id, a);
  const dw = await owned(t, 'warehouses', tro.destination_warehouse_id, a);
  return { ...tro, sourceWarehouse: sw, destinationWarehouse: dw, lines };
}

export async function createTransferOrder(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'dispatch');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = transferOrderCreate.parse(payload);
  const destWh = await owned(t, 'warehouses', p.destinationWarehouseId, a);
  requireRule(
    a.warehouse_id !== destWh.id,
    'SAME_WAREHOUSE',
    'Source and destination warehouses must be distinct. Cross-warehouse transfer requires two separate warehouses.',
    422,
  );

  const existing = (
    await t.query(
      'SELECT id FROM transfer_orders WHERE org_id=$1 AND order_number=$2',
      [a.org_id, p.orderNumber],
    )
  ).rows[0];
  requireRule(!existing, 'DUPLICATE_TRANSFER', 'Transfer order number already exists', 409);

  // Validate line products and units
  for (const l of p.lines) {
    const prod = await owned(t, 'products', l.productId, a);
    requireRule(prod.unit === l.unit, 'UNIT_MISMATCH', `Product ${prod.sku} must use base unit ${prod.unit}`, 422);
  }

  const troId = uuid();
  await t.query(
    `INSERT INTO transfer_orders(id, org_id, order_number, source_warehouse_id, destination_warehouse_id, status, version)
     VALUES($1, $2, $3, $4, $5, 'requested', 1)`,
    [troId, a.org_id, p.orderNumber, a.warehouse_id, destWh.id],
  );

  let lineNum = 1;
  for (const l of p.lines) {
    const lineId = uuid();
    await t.query(
      `INSERT INTO transfer_lines(id, org_id, transfer_order_id, line_number, product_id, box_id, requested_quantity, unit, status, version)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, 'requested', 1)`,
      [
        lineId,
        a.org_id,
        troId,
        lineNum++,
        l.productId,
        l.boxId || null,
        l.requestedQuantity,
        l.unit,
      ],
    );
  }

  await event(t, a, troId, 'transfer.created', {
    orderNumber: p.orderNumber,
    sourceWarehouseId: a.warehouse_id,
    destinationWarehouseId: destWh.id,
    lineCount: p.lines.length,
  });

  return getTransferOrder(t, a, troId);
}

export async function dispatchTransferOrder(
  t: DB,
  a: Actor,
  id: string,
  payload: unknown,
) {
  authorize(a, 'dispatch');
  const p = transferOrderDispatch.parse(payload);
  const tro = await owned(t, 'transfer_orders', id, a, true);
  version(tro, p.expectedVersion);
  requireRule(
    tro.source_warehouse_id === a.warehouse_id,
    'WRONG_WAREHOUSE',
    'Only staff in the source warehouse may dispatch a transfer order',
    403,
  );
  requireRule(
    tro.status === 'requested',
    'INVALID_STATE',
    'Transfer order is not in requested state for dispatch',
    409,
  );

  for (const d of p.lineDispatches) {
    const line = (
      await t.query(
        'SELECT * FROM transfer_lines WHERE id=$1 AND transfer_order_id=$2 FOR UPDATE',
        [d.lineId, id],
      )
    ).rows[0];
    requireRule(line, 'LINE_NOT_FOUND', 'Transfer line not found', 404);

    const dispQty = new Decimal(d.dispatchedQuantity);
    const reqQty = new Decimal(line.requested_quantity);
    requireRule(
      dispQty.lte(reqQty),
      'OVER_DISPATCH',
      'Cannot dispatch more than requested quantity',
      409,
    );

    // Verify source location and deduct stock from source warehouse
    const srcLoc = await owned(t, 'locations', d.sourceLocationId, a);
    const balRes = await t.query(
      'SELECT * FROM inventory_balances WHERE org_id=$1 AND warehouse_id=$2 AND product_id=$3 AND location_id=$4 FOR UPDATE',
      [a.org_id, a.warehouse_id, line.product_id, srcLoc.id],
    );
    const bal = balRes.rows[0];
    requireRule(bal, 'STOCK_NOT_FOUND', 'Stock not found at source location', 404);

    const curAvail = new Decimal(bal.available);
    const curOnHand = new Decimal(bal.on_hand);
    requireRule(
      curAvail.gte(dispQty),
      'INSUFFICIENT_STOCK',
      'Insufficient available stock at source location for transfer dispatch',
      409,
    );

    // Decrement source: available and on_hand decrease; stock leaves warehouse and becomes in_transit
    await t.query(
      'UPDATE inventory_balances SET on_hand=$1, available=$2, in_transit=in_transit+$3, version=version+1, updated_at=now() WHERE id=$4',
      [
        curOnHand.minus(dispQty).toFixed(6),
        curAvail.minus(dispQty).toFixed(6),
        dispQty.toFixed(6),
        bal.id,
      ],
    );

    await t.query(
      "UPDATE transfer_lines SET dispatched_quantity=$1, status='dispatched', version=version+1 WHERE id=$2",
      [dispQty.toFixed(6), line.id],
    );

    // Ledger record
    await t.query(
      `INSERT INTO inventory_ledger(id, org_id, warehouse_id, product_id, location_id, owner_id, quantity_delta, unit, state, reference_type, reference_id, notes, actor_id)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, 'in_transit', 'transfer_dispatch', $9, $10, $11)`,
      [
        uuid(),
        a.org_id,
        a.warehouse_id,
        line.product_id,
        srcLoc.id,
        bal.owner_id,
        dispQty.negated().toFixed(6),
        line.unit,
        id,
        p.reason,
        a.id,
      ],
    );
  }

  await t.query(
    "UPDATE transfer_orders SET status='dispatched', version=version+1 WHERE id=$1",
    [id],
  );

  await event(t, a, id, 'transfer.dispatched', {
    orderNumber: tro.order_number,
    destinationWarehouseId: tro.destination_warehouse_id,
    reason: p.reason,
  });

  return getTransferOrder(t, a, id);
}

export async function receiveTransferOrder(
  t: DB,
  a: Actor,
  id: string,
  payload: unknown,
) {
  authorize(a, 'receive');
  const p = transferOrderReceive.parse(payload);
  const tro = await owned(t, 'transfer_orders', id, a, true);
  version(tro, p.expectedVersion);
  requireRule(
    tro.destination_warehouse_id === a.warehouse_id,
    'WRONG_WAREHOUSE',
    'Only staff in the destination warehouse may receive a transfer order',
    403,
  );
  requireRule(
    tro.status === 'dispatched' || tro.status === 'partially_received',
    'INVALID_STATE',
    'Transfer order is not in dispatched or partially received state',
    409,
  );

  for (const r of p.lineReceipts) {
    const line = (
      await t.query(
        'SELECT * FROM transfer_lines WHERE id=$1 AND transfer_order_id=$2 FOR UPDATE',
        [r.lineId, id],
      )
    ).rows[0];
    requireRule(line, 'LINE_NOT_FOUND', 'Transfer line not found', 404);

    const rcvQty = new Decimal(r.receivedQuantity);
    const dmgQty = new Decimal(r.damagedQuantity || '0');
    const dispQty = new Decimal(line.dispatched_quantity);
    const prevRcv = new Decimal(line.received_quantity);
    const prevDmg = new Decimal(line.damaged_quantity);

    const totalThisReceipt = rcvQty.plus(dmgQty);
    requireRule(
      prevRcv.plus(prevDmg).plus(totalThisReceipt).lte(dispQty),
      'OVER_RECEIPT',
      'Total received and damaged quantity exceeds dispatched in-transit quantity',
      409,
    );

    const destLoc = await owned(t, 'locations', r.locationId, a);
    const ownerId = `${a.org_id}:default_owner`;

    // 1. Remove in_transit from source warehouse balance
    await t.query(
      `UPDATE inventory_balances
       SET in_transit = GREATEST(0, in_transit - $1), updated_at=now()
       WHERE org_id=$2 AND warehouse_id=$3 AND product_id=$4`,
      [totalThisReceipt.toFixed(6), a.org_id, tro.source_warehouse_id, line.product_id],
    );

    // 2. Create/update destination stock balance
    // Good stock -> available and on_hand
    if (rcvQty.gt(0)) {
      const destBalRes = await t.query(
        'SELECT * FROM inventory_balances WHERE org_id=$1 AND warehouse_id=$2 AND product_id=$3 AND location_id=$4 AND owner_id=$5 AND unit=$6 FOR UPDATE',
        [a.org_id, a.warehouse_id, line.product_id, destLoc.id, ownerId, line.unit],
      );
      const destBal = destBalRes.rows[0];
      if (destBal) {
        await t.query(
          'UPDATE inventory_balances SET on_hand=on_hand+$1, available=available+$1, version=version+1, updated_at=now() WHERE id=$2',
          [rcvQty.toFixed(6), destBal.id],
        );
      } else {
        await t.query(
          `INSERT INTO inventory_balances(id, org_id, warehouse_id, product_id, location_id, owner_id, unit, on_hand, reserved, available, picked, in_transit, held, dispatched, version)
           VALUES($1, $2, $3, $4, $5, $6, $7, $8, 0, $8, 0, 0, 0, 0, 1)`,
          [
            uuid(),
            a.org_id,
            a.warehouse_id,
            line.product_id,
            destLoc.id,
            ownerId,
            line.unit,
            rcvQty.toFixed(6),
          ],
        );
      }
    }

    // Damaged stock -> held and on_hand
    if (dmgQty.gt(0)) {
      const destBalRes = await t.query(
        'SELECT * FROM inventory_balances WHERE org_id=$1 AND warehouse_id=$2 AND product_id=$3 AND location_id=$4 AND owner_id=$5 AND unit=$6 FOR UPDATE',
        [a.org_id, a.warehouse_id, line.product_id, destLoc.id, ownerId, line.unit],
      );
      const destBal = destBalRes.rows[0];
      if (destBal) {
        await t.query(
          'UPDATE inventory_balances SET on_hand=on_hand+$1, held=held+$1, version=version+1, updated_at=now() WHERE id=$2',
          [dmgQty.toFixed(6), destBal.id],
        );
      } else {
        await t.query(
          `INSERT INTO inventory_balances(id, org_id, warehouse_id, product_id, location_id, owner_id, unit, on_hand, reserved, available, picked, in_transit, held, dispatched, version)
           VALUES($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 0, 0, $8, 0, 1)`,
          [
            uuid(),
            a.org_id,
            a.warehouse_id,
            line.product_id,
            destLoc.id,
            ownerId,
            line.unit,
            dmgQty.toFixed(6),
          ],
        );
      }

      // Record discrepancy for damaged transit
      await t.query(
        `INSERT INTO inbound_discrepancies(id, org_id, warehouse_id, product_id, kind, reported_quantity, unit, evidence, status, disposition, version)
         VALUES($1, $2, $3, $4, 'damaged', $5, $6, $7, 'approved', 'accept_hold', 1)`,
        [
          uuid(),
          a.org_id,
          a.warehouse_id,
          line.product_id,
          dmgQty.toFixed(6),
          line.unit,
          `Damaged upon inter-warehouse transfer receipt: ${tro.order_number}`,
        ],
      );
    }

    const nextLineReceived = prevRcv.plus(rcvQty);
    const nextLineDamaged = prevDmg.plus(dmgQty);
    const lineNextStatus = nextLineReceived.plus(nextLineDamaged).equals(dispQty)
      ? 'received'
      : 'partially_received';

    await t.query(
      'UPDATE transfer_lines SET received_quantity=$1, damaged_quantity=$2, status=$3, version=version+1 WHERE id=$4',
      [nextLineReceived.toFixed(6), nextLineDamaged.toFixed(6), lineNextStatus, line.id],
    );

    // Ledger record
    await t.query(
      `INSERT INTO inventory_ledger(id, org_id, warehouse_id, product_id, location_id, owner_id, quantity_delta, unit, state, reference_type, reference_id, notes, actor_id)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, 'available', 'transfer_receipt', $9, $10, $11)`,
      [
        uuid(),
        a.org_id,
        a.warehouse_id,
        line.product_id,
        destLoc.id,
        ownerId,
        rcvQty.toFixed(6),
        line.unit,
        id,
        p.reason,
        a.id,
      ],
    );
  }

  // Update order status
  const allLines = (
    await t.query(
      'SELECT status FROM transfer_lines WHERE transfer_order_id=$1',
      [id],
    )
  ).rows;
  const allRcvd = allLines.every((l) => l.status === 'received');
  const nextOrderStatus = allRcvd ? 'received' : 'partially_received';

  await t.query(
    'UPDATE transfer_orders SET status=$1, version=version+1 WHERE id=$2',
    [nextOrderStatus, id],
  );

  await event(t, a, id, 'transfer.received', {
    orderNumber: tro.order_number,
    status: nextOrderStatus,
    reason: p.reason,
  });

  return getTransferOrder(t, a, id);
}

export async function cancelTransferOrder(
  t: DB,
  a: Actor,
  id: string,
  payload: unknown,
) {
  authorize(a, 'adjust');
  const p = transferOrderCancel.parse(payload);
  const tro = await owned(t, 'transfer_orders', id, a, true);
  version(tro, p.expectedVersion);
  requireRule(
    tro.status === 'requested',
    'CANNOT_CANCEL',
    'Only requested transfer orders prior to dispatch can be cancelled',
    409,
  );

  await t.query(
    "UPDATE transfer_orders SET status='cancelled', version=version+1 WHERE id=$1",
    [id],
  );
  await t.query(
    "UPDATE transfer_lines SET status='cancelled', version=version+1 WHERE transfer_order_id=$1",
    [id],
  );

  await event(t, a, id, 'transfer.cancelled', {
    reason: p.reason,
  });

  return getTransferOrder(t, a, id);
}
