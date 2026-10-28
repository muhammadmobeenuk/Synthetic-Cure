import { randomUUID as uuid } from 'node:crypto';
import Decimal from 'decimal.js';
import type { DB } from '../database/index.js';
import { orderCancelReconcile } from '../contracts/orders.js';
import { authorize, owned, version, event, type Actor, invalidate } from './services.js';
import { requireRule } from './index.js';

export async function cancelOrderWithReconciliation(
  t: DB,
  a: Actor,
  id: string,
  payload: unknown,
) {
  const p = orderCancelReconcile.parse(payload);
  const o = await owned(t, 'orders', id, a, true);
  version(o, p.expectedVersion);
  requireRule(o.status === 'open', 'ORDER_STATE', 'Cannot cancel a closed order', 409);

  // Check if any goods are already dispatched
  const dispatched = (
    await t.query(
      "SELECT id FROM shipments WHERE order_id=$1 AND status IN ('dispatched','partial','completed')",
      [id],
    )
  ).rows;
  requireRule(!dispatched.length, 'CUSTODY_STATE', 'Resolve dispatched goods before cancellation', 409);

  // Packed or allocated cancellation requires supervisor adjustment authorization
  const allocs = (
    await t.query('SELECT * FROM allocations WHERE order_id=$1', [id])
  ).rows;
  if (allocs.length > 0) {
    authorize(a, 'adjust');
  }

  // Release allocations and invalidate pallet checks
  await t.query('DELETE FROM allocations WHERE order_id=$1', [id]);
  for (const al of allocs) {
    await invalidate(t, a, al.box_id);
  }

  // Invalidate and cancel existing shipments
  await t.query(
    "UPDATE shipments SET status='cancelled', version=version+1 WHERE order_id=$1",
    [id],
  );
  await t.query(
    'DELETE FROM shipment_lines WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id=$1)',
    [id],
  );

  // Delete preparation order links
  await t.query('DELETE FROM preparation_orders WHERE order_id=$1', [id]);

  // Backorder creation if requested
  const shouldCreateBackorders = Boolean(p.createBackorders || p.createBackorder);
  const backorderRecords: any[] = [];
  if (shouldCreateBackorders) {
    const lines = (
      await t.query('SELECT * FROM order_lines WHERE order_id=$1', [id])
    ).rows;
    for (const l of lines) {
      const allocatedForLine = allocs
        .filter((al) => al.order_line_id === l.id)
        .reduce((sum, al) => sum.plus(al.quantity), new Decimal(0));
      const requestedQty = new Decimal(l.quantity);
      const backorderQty = Decimal.max(requestedQty.minus(allocatedForLine), 0);
      if (backorderQty.gt(0)) {
        const bId = uuid();
        await t.query(
          `INSERT INTO order_backorders(
             id, org_id, warehouse_id, order_id, order_line_id, product_id,
             requested_quantity, fulfilled_quantity, backorder_quantity, unit, status, reason
           ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11)`,
          [
            bId,
            a.org_id,
            a.warehouse_id,
            id,
            l.id,
            l.product_id,
            requestedQty.toFixed(6),
            allocatedForLine.toFixed(6),
            backorderQty.toFixed(6),
            l.unit,
            p.reason,
          ],
        );
        backorderRecords.push(bId);
      }
    }
  }

  await t.query("UPDATE orders SET status='cancelled', version=version+1 WHERE id=$1", [id]);

  // Compensating event
  await event(t, a, id, 'order.reconciled_cancellation', {
    reason: p.reason,
    cancelledAllocationsCount: allocs.length,
    backorderCreated: backorderRecords.length > 0,
    backorderCount: backorderRecords.length,
  });

  return owned(t, 'orders', id, a);
}

export async function listOrderBackorders(
  t: DB,
  a: Actor,
  filters?: { orderId?: string },
) {
  authorize(a, 'review');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  let sql = `
    SELECT ob.*,
           p.sku, p.name product_name, p.name_zh,
           o.code order_code
    FROM order_backorders ob
    JOIN products p ON p.id = ob.product_id AND p.org_id = ob.org_id
    JOIN orders o ON o.id = ob.order_id AND o.org_id = ob.org_id
    WHERE ob.org_id = $1 AND ob.warehouse_id = $2
  `;
  const params: any[] = [a.org_id, a.warehouse_id];
  if (filters?.orderId) {
    params.push(filters.orderId);
    sql += ` AND ob.order_id = $${params.length}`;
  }
  sql += ' ORDER BY ob.created_at DESC LIMIT 100';
  return (await t.query(sql, params)).rows;
}
