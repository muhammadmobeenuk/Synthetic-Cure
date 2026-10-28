import { randomUUID as uuid } from 'node:crypto';
import Decimal from 'decimal.js';
import type { DB } from '../database/index.js';
import {
  putawayTaskCreate,
  taskAssign,
  taskClaim,
  taskReassign,
  taskStart,
  taskBlock,
  taskComplete,
  taskCancel,
  shiftHandoverCreate,
  shiftHandoverAcknowledge,
  replenishmentPolicySet,
  replenishmentTrigger,
} from '../contracts/tasks.js';
import { authorize, owned, version, event, type Actor } from './services.js';
import { requireRule, DomainError } from './index.js';

export async function listTasks(
  t: DB,
  a: Actor,
  filters?: { kind?: string; status?: string; assignedUserId?: string },
) {
  authorize(a, 'review');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  let sql = `
    SELECT wt.*,
           p.sku, p.name product_name, p.name_zh,
           b.code box_code,
           sl.code source_location_code, dl.code destination_location_code,
           u.name assigned_user_name,
           cu.name claimed_by_name
    FROM warehouse_tasks wt
    LEFT JOIN products p ON p.id = wt.product_id AND p.org_id = wt.org_id
    LEFT JOIN boxes b ON b.id = wt.box_id AND b.warehouse_id = wt.warehouse_id
    JOIN locations sl ON sl.id = wt.source_location_id AND sl.warehouse_id = wt.warehouse_id
    JOIN locations dl ON dl.id = wt.destination_location_id AND dl.warehouse_id = wt.warehouse_id
    LEFT JOIN users u ON u.id = wt.assigned_user_id
    LEFT JOIN users cu ON cu.id = wt.claimed_by
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
  if (filters?.assignedUserId) {
    params.push(filters.assignedUserId);
    sql += ` AND wt.assigned_user_id = $${params.length}`;
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
    `INSERT INTO warehouse_tasks(id, org_id, warehouse_id, kind, status, priority, product_id, box_id, source_location_id, destination_location_id, quantity, unit, due_at, version)
     VALUES($1, $2, $3, 'putaway', 'pending', $4, $5, $6, $7, $8, $9, $10, $11, 1)`,
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
      p.dueAt || null,
    ],
  );

  await event(t, a, taskId, 'task.putaway_created', {
    boxId,
    productId: prodId,
    sourceLocationId: srcLoc.id,
    destinationLocationId: destLoc.id,
    quantity: qty,
    dueAt: p.dueAt,
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
    task.status === 'pending' || task.status === 'assigned' || task.status === 'claimed',
    'TASK_NOT_OPEN',
    'Task is not in assignable status',
    409,
  );

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
    reason: p.reason,
  });

  return owned(t, 'warehouse_tasks', taskId, a);
}

export async function claimTask(
  t: DB,
  a: Actor,
  taskId: string,
  payload: unknown,
) {
  authorize(a, 'prepare');
  const p = taskClaim.parse(payload);
  const task = await owned(t, 'warehouse_tasks', taskId, a, true);
  version(task, p.expectedVersion);
  requireRule(
    task.status === 'pending' || task.status === 'assigned',
    'TASK_NOT_CLAIMABLE',
    'Task must be in pending or assigned status to claim',
    409,
  );

  await t.query(
    "UPDATE warehouse_tasks SET claimed_by=$1, claimed_at=now(), assigned_user_id=$1, status='claimed', version=version+1 WHERE id=$2",
    [a.id, taskId],
  );

  await event(t, a, taskId, 'task.claimed', {
    claimedBy: a.id,
    claimedByName: a.name,
  });

  return owned(t, 'warehouse_tasks', taskId, a);
}

export async function reassignTask(
  t: DB,
  a: Actor,
  taskId: string,
  payload: unknown,
) {
  authorize(a, 'prepare');
  const p = taskReassign.parse(payload);
  const task = await owned(t, 'warehouse_tasks', taskId, a, true);
  version(task, p.expectedVersion);
  requireRule(
    task.status !== 'completed' && task.status !== 'cancelled',
    'TASK_CLOSED',
    'Cannot reassign completed or cancelled task',
    409,
  );

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

  await event(t, a, taskId, 'task.reassigned', {
    previousUserId: task.assigned_user_id,
    newUserId: user.id,
    newUserName: user.name,
    reason: p.reason,
  });

  return owned(t, 'warehouse_tasks', taskId, a);
}

export async function startTask(
  t: DB,
  a: Actor,
  taskId: string,
  payload: unknown,
) {
  authorize(a, 'prepare');
  const p = taskStart.parse(payload);
  const task = await owned(t, 'warehouse_tasks', taskId, a, true);
  version(task, p.expectedVersion);
  requireRule(
    ['pending', 'assigned', 'claimed', 'blocked'].includes(task.status),
    'TASK_CANNOT_START',
    'Task is not in a startable state',
    409,
  );

  await t.query(
    "UPDATE warehouse_tasks SET status='in_progress', started_at=COALESCE(started_at, now()), blocked_reason=NULL, version=version+1 WHERE id=$1",
    [taskId],
  );

  await event(t, a, taskId, 'task.started', {
    startedAt: new Date().toISOString(),
  });

  return owned(t, 'warehouse_tasks', taskId, a);
}

export async function blockTask(
  t: DB,
  a: Actor,
  taskId: string,
  payload: unknown,
) {
  authorize(a, 'prepare');
  const p = taskBlock.parse(payload);
  const task = await owned(t, 'warehouse_tasks', taskId, a, true);
  version(task, p.expectedVersion);
  requireRule(
    task.status !== 'completed' && task.status !== 'cancelled',
    'TASK_CLOSED',
    'Cannot block a closed task',
    409,
  );

  await t.query(
    "UPDATE warehouse_tasks SET status='blocked', blocked_reason=$1, version=version+1 WHERE id=$2",
    [p.reason, taskId],
  );

  await event(t, a, taskId, 'task.blocked', {
    reason: p.reason,
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
    ['assigned', 'in_progress', 'claimed', 'pending'].includes(task.status),
    'TASK_NOT_ACTIVE',
    'Task is already completed or cancelled',
    409,
  );

  // Validate scan confirmation against destination location, box code, or product SKU/ID
  const destLoc = await owned(t, 'locations', task.destination_location_id, a);
  let expectedScan = destLoc.code;
  if (task.box_id) {
    const box = await owned(t, 'boxes', task.box_id, a);
    expectedScan = box.code;
  }
  const prod = task.product_id ? await owned(t, 'products', task.product_id, a).catch(() => null) : null;
  const validScans = [
    destLoc.code.toUpperCase(),
    destLoc.id.toUpperCase(),
    expectedScan.toUpperCase(),
    prod?.sku?.toUpperCase(),
    prod?.id?.toUpperCase(),
    task.product_id?.toUpperCase(),
  ].filter((s): s is string => typeof s === 'string' && s.length > 0);

  requireRule(
    validScans.includes(p.scanConfirmation.toUpperCase()),
    'SCAN_MISMATCH',
    `Scan verification failed. Scanned ${p.scanConfirmation}, expected ${expectedScan}`,
    422,
  );

  // Invariant: Completing a task does NOT itself mutate stock; the actual domain command must succeed.
  await t.query(
    "UPDATE warehouse_tasks SET status='completed', scan_confirmation=$1, execution_reference_id=$2, completed_at=now(), version=version+1 WHERE id=$3",
    [p.scanConfirmation, p.executionReferenceId || null, taskId],
  );

  await event(t, a, taskId, 'task.completed', {
    kind: task.kind,
    destinationLocationId: destLoc.id,
    scanConfirmation: p.scanConfirmation,
    executionReferenceId: p.executionReferenceId,
    reason: p.reason,
  });

  return owned(t, 'warehouse_tasks', taskId, a);
}

export async function createShiftHandover(
  t: DB,
  a: Actor,
  payload: unknown,
) {
  authorize(a, 'prepare');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = shiftHandoverCreate.parse(payload);

  if (p.incomingUserId) {
    const incoming = (
      await t.query('SELECT id, name FROM users WHERE id=$1 AND org_id=$2', [
        p.incomingUserId,
        a.org_id,
      ])
    ).rows[0];
    requireRule(incoming, 'USER_NOT_FOUND', 'Incoming staff member not found', 404);
  }

  // Snapshot active and blocked tasks in the warehouse
  const pendingTasks = (
    await t.query(
      `SELECT id, kind, status, priority, product_id, box_id, source_location_id, destination_location_id, due_at, assigned_user_id
       FROM warehouse_tasks
       WHERE org_id=$1 AND warehouse_id=$2 AND status IN ('pending', 'assigned', 'claimed', 'in_progress')
       ORDER BY priority DESC, created_at ASC`,
      [a.org_id, a.warehouse_id],
    )
  ).rows;

  const blockedTasks = (
    await t.query(
      `SELECT id, kind, status, priority, product_id, box_id, blocked_reason, assigned_user_id
       FROM warehouse_tasks
       WHERE org_id=$1 AND warehouse_id=$2 AND status = 'blocked'
       ORDER BY priority DESC, created_at ASC`,
      [a.org_id, a.warehouse_id],
    )
  ).rows;

  const handoverId = uuid();
  await t.query(
    `INSERT INTO shift_handovers(id, org_id, warehouse_id, outgoing_user_id, incoming_user_id, shift_name, handover_date, notes, pending_tasks, blocked_tasks, version)
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)`,
    [
      handoverId,
      a.org_id,
      a.warehouse_id,
      a.id,
      p.incomingUserId || null,
      p.shiftName,
      p.handoverDate,
      p.notes,
      JSON.stringify(pendingTasks),
      JSON.stringify(blockedTasks),
    ],
  );

  await event(t, a, handoverId, 'shift.handover_created', {
    shiftName: p.shiftName,
    handoverDate: p.handoverDate,
    pendingTasksCount: pendingTasks.length,
    blockedTasksCount: blockedTasks.length,
    incomingUserId: p.incomingUserId,
  });

  return owned(t, 'shift_handovers', handoverId, a);
}

export async function acknowledgeShiftHandover(
  t: DB,
  a: Actor,
  handoverId: string,
  payload: unknown,
) {
  authorize(a, 'prepare');
  const p = shiftHandoverAcknowledge.parse(payload);
  const handover = await owned(t, 'shift_handovers', handoverId, a, true);
  version(handover, p.expectedVersion);
  requireRule(!handover.acknowledged_at, 'ALREADY_ACKNOWLEDGED', 'Handover is already acknowledged', 409);

  await t.query(
    'UPDATE shift_handovers SET acknowledged_at=now(), incoming_user_id=COALESCE(incoming_user_id, $1), version=version+1 WHERE id=$2',
    [a.id, handoverId],
  );

  await event(t, a, handoverId, 'shift.handover_acknowledged', {
    acknowledgedBy: a.id,
    notes: p.notes,
  });

  return owned(t, 'shift_handovers', handoverId, a);
}

export async function listShiftHandovers(t: DB, a: Actor) {
  authorize(a, 'review');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  return (
    await t.query(
      `SELECT sh.*, u1.name outgoing_user_name, u2.name incoming_user_name
       FROM shift_handovers sh
       JOIN users u1 ON u1.id = sh.outgoing_user_id
       LEFT JOIN users u2 ON u2.id = sh.incoming_user_id
       WHERE sh.org_id = $1 AND sh.warehouse_id = $2
       ORDER BY sh.handover_date DESC, sh.created_at DESC LIMIT 50`,
      [a.org_id, a.warehouse_id],
    )
  ).rows;
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
