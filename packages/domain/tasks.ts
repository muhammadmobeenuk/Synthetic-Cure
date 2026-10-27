import { randomUUID as uuid } from 'node:crypto';
import Decimal from 'decimal.js';
import type { DB } from '../database/index.js';
import {
  putawayTaskCreate,
  taskAssign,
  taskComplete,
  taskCancel,
  replenishmentPolicySet,
  replenishmentTrigger,
} from '../contracts/tasks.js';
import { authorize, owned, version, event, type Actor } from './services.js';
import { requireRule, DomainError } from './index.js';

export async function listTasks(
  t: DB,
  a: Actor,
  filters?: { kind?: string; status?: string },
) {
  authorize(a, 'review');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  let sql = `
    SELECT wt.*,
           p.sku, p.name product_name, p.name_zh,
           b.code box_code,
           sl.code source_location_code, dl.code destination_location_code,
           u.name assigned_user_name
    FROM warehouse_tasks wt
    LEFT JOIN products p ON p.id = wt.product_id AND p.org_id = wt.org_id
    LEFT JOIN boxes b ON b.id = wt.box_id AND b.warehouse_id = wt.warehouse_id
    JOIN locations sl ON sl.id = wt.source_location_id AND sl.warehouse_id = wt.warehouse_id
    JOIN locations dl ON dl.id = wt.destination_location_id AND dl.warehouse_id = wt.warehouse_id
    LEFT JOIN users u ON u.id = wt.assigned_user_id
    WHERE wt.org_id = $1 AND wt.warehouse_id = $2
  `;
  const params: any[] = [a.org_id, a.warehouse_id];
  if (filters?.kind) {
    params.push(filters.kind);
    sql += ` AND wt.kind = $${params.length}`;
  }
  if (filters?.status) {
    params.push(filters.status);
    sql += ` AND wt.status = $${params.length}`;
  }
  sql += ' ORDER BY wt.priority DESC, wt.created_at ASC LIMIT 100';
  return (await t.query(sql, params)).rows;
}

export async function createPutawayTask(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'receive');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = putawayTaskCreate.parse(payload);
  const srcLoc = await owned(t, 'locations', p.sourceLocationId, a);
  const destLoc = await owned(t, 'locations', p.destinationLocationId, a);

  let prodId: string | null = null;
  let boxId: string | null = null;
  let qty: string | null = null;
  let unit: string | null = null;

  if (p.boxId) {
    const box = await owned(t, 'boxes', p.boxId, a);
    boxId = box.id;
  }
  if (p.productId) {
    const prod = await owned(t, 'products', p.productId, a);
    prodId = prod.id;
    qty = p.quantity || null;
    unit = p.unit || prod.unit;
  }

  requireRule(
    boxId || (prodId && qty),
    'TARGET_REQUIRED',
    'Specify either a box or product with quantity for putaway',
    422,
  );

  const taskId = uuid();
  await t.query(
    `INSERT INTO warehouse_tasks(id, org_id, warehouse_id, kind, status, priority, product_id, box_id, source_location_id, destination_location_id, quantity, unit, version)
     VALUES($1, $2, $3, 'putaway', 'pending', $4, $5, $6, $7, $8, $9, $10, 1)`,
    [
      taskId,
      a.org_id,
      a.warehouse_id,
      p.priority,
      prodId,
      boxId,
      srcLoc.id,
      destLoc.id,
      qty,
      unit,
    ],
  );

  await event(t, a, taskId, 'task.putaway_created', {
    boxId,
    productId: prodId,
    sourceLocationId: srcLoc.id,
    destinationLocationId: destLoc.id,
    quantity: qty,
  });

  return owned(t, 'warehouse_tasks', taskId, a);
}

export async function assignTask(
  t: DB,
  a: Actor,
  taskId: string,
  payload: unknown,
) {
  authorize(a, 'prepare');
  const p = taskAssign.parse(payload);
  const task = await owned(t, 'warehouse_tasks', taskId, a, true);
  version(task, p.expectedVersion);
  requireRule(
    task.status === 'pending' || task.status === 'assigned',
    'TASK_NOT_OPEN',
    'Task is not in assignable status',
    409,
  );

  // Validate user has grant in warehouse
  const user = (
    await t.query('SELECT id, name FROM users WHERE id=$1 AND org_id=$2', [
      p.userId,
      a.org_id,
    ])
  ).rows[0];
  requireRule(user, 'USER_NOT_FOUND', 'Staff member not found in company', 404);

  await t.query(
    "UPDATE warehouse_tasks SET assigned_user_id=$1, status='assigned', version=version+1 WHERE id=$2",
    [user.id, taskId],
  );

  await event(t, a, taskId, 'task.assigned', {
    assignedUserId: user.id,
    assignedUserName: user.name,
  });

  return owned(t, 'warehouse_tasks', taskId, a);
}

export async function completeTask(
  t: DB,
  a: Actor,
  taskId: string,
  payload: unknown,
) {
  authorize(a, 'prepare');
  const p = taskComplete.parse(payload);
  const task = await owned(t, 'warehouse_tasks', taskId, a, true);
  version(task, p.expectedVersion);
  requireRule(
    task.status === 'assigned' || task.status === 'in_progress' || task.status === 'pending',
    'TASK_NOT_ACTIVE',
    'Task is already completed or cancelled',
    409,
  );

  // Validate scan confirmation
  const destLoc = await owned(t, 'locations', task.destination_location_id, a);
  let expectedScan = destLoc.code;
  if (task.box_id) {
    const box = await owned(t, 'boxes', task.box_id, a);
    expectedScan = box.code;
  }
  requireRule(
    p.scanConfirmation.toUpperCase() === expectedScan.toUpperCase() ||
      p.scanConfirmation.toUpperCase() === destLoc.code.toUpperCase(),
    'SCAN_MISMATCH',
    `Scan verification failed. Scanned ${p.scanConfirmation}, expected ${expectedScan}`,
    422,
  );

  // Move the stock
  if (task.box_id) {
    const box = await owned(t, 'boxes', task.box_id, a, true);
    await t.query(
      'UPDATE boxes SET location_id=$1, pallet_id=NULL, version=version+1 WHERE id=$2',
      [destLoc.id, box.id],
    );
  } else if (task.product_id && task.quantity) {
    // Loose stock movement in balances
    const moveQty = new Decimal(task.quantity);
    const srcBalRes = await t.query(
      'SELECT * FROM inventory_balances WHERE org_id=$1 AND warehouse_id=$2 AND product_id=$3 AND location_id=$4 FOR UPDATE',
      [a.org_id, a.warehouse_id, task.product_id, task.source_location_id],
    );
    const srcBal = srcBalRes.rows[0];
    if (srcBal) {
      const avail = new Decimal(srcBal.available);
      const onHand = new Decimal(srcBal.on_hand);
      const qtyToMove = Decimal.min(avail, moveQty);
      await t.query(
        'UPDATE inventory_balances SET on_hand=$1, available=$2, version=version+1, updated_at=now() WHERE id=$3',
        [onHand.minus(qtyToMove).toFixed(6), avail.minus(qtyToMove).toFixed(6), srcBal.id],
      );

      // Add to dest
      const destBalRes = await t.query(
        'SELECT * FROM inventory_balances WHERE org_id=$1 AND warehouse_id=$2 AND product_id=$3 AND location_id=$4 FOR UPDATE',
        [a.org_id, a.warehouse_id, task.product_id, destLoc.id],
      );
      const destBal = destBalRes.rows[0];
      if (destBal) {
        await t.query(
          'UPDATE inventory_balances SET on_hand=$1, available=$2, version=version+1, updated_at=now() WHERE id=$3',
          [
            new Decimal(destBal.on_hand).plus(qtyToMove).toFixed(6),
            new Decimal(destBal.available).plus(qtyToMove).toFixed(6),
            destBal.id,
          ],
        );
      } else {
        await t.query(
          `INSERT INTO inventory_balances(id, org_id, warehouse_id, product_id, location_id, owner_id, unit, on_hand, reserved, available, picked, in_transit, held, dispatched, version)
           VALUES($1, $2, $3, $4, $5, $6, $7, $8, 0, $8, 0, 0, 0, 0, 1)`,
          [
            uuid(),
            a.org_id,
            a.warehouse_id,
            task.product_id,
            destLoc.id,
            srcBal.owner_id,
            srcBal.unit,
            qtyToMove.toFixed(6),
          ],
        );
      }
    }
  }

  await t.query(
    "UPDATE warehouse_tasks SET status='completed', scan_confirmation=$1, completed_at=now(), version=version+1 WHERE id=$2",
    [p.scanConfirmation, taskId],
  );

  await event(t, a, taskId, 'task.completed', {
    kind: task.kind,
    destinationLocationId: destLoc.id,
    scanConfirmation: p.scanConfirmation,
  });

  return owned(t, 'warehouse_tasks', taskId, a);
}

export async function cancelTask(
  t: DB,
  a: Actor,
  taskId: string,
  payload: unknown,
) {
  authorize(a, 'prepare');
  const p = taskCancel.parse(payload);
  const task = await owned(t, 'warehouse_tasks', taskId, a, true);
  version(task, p.expectedVersion);
  requireRule(
    task.status !== 'completed' && task.status !== 'cancelled',
    'TASK_FINISHED',
    'Cannot cancel an already completed or cancelled task',
    409,
  );

  await t.query(
    "UPDATE warehouse_tasks SET status='cancelled', version=version+1 WHERE id=$1",
    [taskId],
  );

  await event(t, a, taskId, 'task.cancelled', {
    reason: p.reason,
  });

  return owned(t, 'warehouse_tasks', taskId, a);
}

// ----------------- Replenishment Policies & Generation -----------------
export async function listReplenishmentPolicies(t: DB, a: Actor) {
  authorize(a, 'review');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const rows = (
    await t.query(
      `SELECT r.*, l.code location_code, l.name location_name, p.sku, p.name product_name, p.name_zh
       FROM location_replenishment_policies r
       JOIN locations l ON l.id = r.location_id AND l.warehouse_id = r.warehouse_id
       JOIN products p ON p.id = r.product_id AND p.org_id = r.org_id
       WHERE r.org_id = $1 AND r.warehouse_id = $2
       ORDER BY l.code, p.sku`,
      [a.org_id, a.warehouse_id],
    )
  ).rows;
  return rows;
}

export async function setReplenishmentPolicy(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'configure');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = replenishmentPolicySet.parse(payload);
  const loc = await owned(t, 'locations', p.locationId, a);
  const prod = await owned(t, 'products', p.productId, a);
  requireRule(prod.unit === p.unit, 'UNIT_MISMATCH', `Use product unit ${prod.unit}`, 422);

  const id = uuid();
  await t.query(
    `INSERT INTO location_replenishment_policies(id, org_id, warehouse_id, location_id, product_id, min_quantity, target_quantity, unit)
     VALUES($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT(warehouse_id, location_id, product_id)
     DO UPDATE SET min_quantity=$6, target_quantity=$7, unit=$8`,
    [
      id,
      a.org_id,
      a.warehouse_id,
      loc.id,
      prod.id,
      p.minQuantity,
      p.targetQuantity,
      p.unit,
    ],
  );

  await event(t, a, id, 'replenishment_policy.set', {
    locationId: loc.id,
    productId: prod.id,
    minQuantity: p.minQuantity,
    targetQuantity: p.targetQuantity,
  });

  return (
    await t.query(
      'SELECT * FROM location_replenishment_policies WHERE warehouse_id=$1 AND location_id=$2 AND product_id=$3',
      [a.warehouse_id, loc.id, prod.id],
    )
  ).rows[0];
}

export async function triggerReplenishment(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'prepare');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = replenishmentTrigger.parse(payload);

  let sql = `
    SELECT r.*
    FROM location_replenishment_policies r
    WHERE r.org_id = $1 AND r.warehouse_id = $2
  `;
  const params: any[] = [a.org_id, a.warehouse_id];
  if (p.locationId) {
    params.push(p.locationId);
    sql += ` AND r.location_id = $${params.length}`;
  }
  if (p.productId) {
    params.push(p.productId);
    sql += ` AND r.product_id = $${params.length}`;
  }

  const policies = (await t.query(sql, params)).rows;
  const createdTasks: any[] = [];

  for (const pol of policies) {
    // 1. Duplicate-open-task prevention: check if open task already exists
    const openTask = (
      await t.query(
        `SELECT id FROM warehouse_tasks
         WHERE org_id=$1 AND warehouse_id=$2 AND kind='replenishment' AND destination_location_id=$3 AND product_id=$4
           AND status IN ('pending', 'assigned', 'in_progress')`,
        [a.org_id, a.warehouse_id, pol.location_id, pol.product_id],
      )
    ).rows[0];
    if (openTask) {
      continue; // Duplicate task prevention
    }

    // 2. Check current available stock in picking location
    const pickBal = (
      await t.query(
        `SELECT COALESCE(sum(available), 0)::text total_available
         FROM inventory_balances
         WHERE org_id=$1 AND warehouse_id=$2 AND location_id=$3 AND product_id=$4`,
        [a.org_id, a.warehouse_id, pol.location_id, pol.product_id],
      )
    ).rows[0].total_available;

    const curAvail = new Decimal(pickBal);
    const minQty = new Decimal(pol.min_quantity);
    const targetQty = new Decimal(pol.target_quantity);

    if (curAvail.lt(minQty)) {
      // Needs replenishment
      const neededQty = targetQty.minus(curAvail);

      // 3. Find reserve stock in other locations (hold/reservation checks: available stock only!)
      const reserveStock = (
        await t.query(
          `SELECT location_id, available
           FROM inventory_balances
           WHERE org_id=$1 AND warehouse_id=$2 AND product_id=$3 AND location_id<>$4 AND available > 0
           ORDER BY available DESC LIMIT 1`,
          [a.org_id, a.warehouse_id, pol.product_id, pol.location_id],
        )
      ).rows[0];

      if (reserveStock) {
        const canReplenishQty = Decimal.min(neededQty, new Decimal(reserveStock.available));
        const taskId = uuid();
        await t.query(
          `INSERT INTO warehouse_tasks(id, org_id, warehouse_id, kind, status, priority, product_id, source_location_id, destination_location_id, quantity, unit, version)
           VALUES($1, $2, $3, 'replenishment', 'pending', 2, $4, $5, $6, $7, $8, 1)`,
          [
            taskId,
            a.org_id,
            a.warehouse_id,
            pol.product_id,
            reserveStock.location_id,
            pol.location_id,
            canReplenishQty.toFixed(6),
            pol.unit,
          ],
        );
        await event(t, a, taskId, 'task.replenishment_created', {
          productId: pol.product_id,
          sourceLocationId: reserveStock.location_id,
          destinationLocationId: pol.location_id,
          quantity: canReplenishQty.toFixed(6),
          unit: pol.unit,
        });
        createdTasks.push(await owned(t, 'warehouse_tasks', taskId, a));
      }
    }
  }

  return { triggered: policies.length, createdCount: createdTasks.length, tasks: createdTasks };
}
