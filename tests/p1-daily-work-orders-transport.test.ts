import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as uuid } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Decimal from 'decimal.js';
import { openDatabase, migrate, type DB } from '../packages/database/index.js';
import { seed } from '../packages/database/seed.js';
import { createApp } from '../apps/api/app.js';
import { inject } from './inject.js';
import {
  claimTask,
  reassignTask,
  startTask,
  blockTask,
  createShiftHandover,
  acknowledgeShiftHandover,
  listShiftHandovers,
  registerTote,
  listTotes,
  verifyPickOperation,
  listPickVerifications,
  loadPalletGroupWorkflow,
  reassignTripDriver,
  failStopDelivery,
  collectStopReturn,
  listDriverReassignments,
  cancelOrderWithReconciliation,
  listOrderBackorders,
  getCustomerDeliveryNote,
  getCustomerInvoice,
  getRecipientPalletLabels,
  suggestPreparationBatches,
  createScheduledEmptyBatch,
  services,
  boxState,
  createPalletGroup,
  changePalletGroup,
} from '../packages/domain/index.js';

let db: DB;
let app: any;
let uploadsDir: string;
let adminHeaders: Record<string, string>;
let supervisorHeaders: Record<string, string>;
let operatorHeaders: Record<string, string>;
let driverHeaders: Record<string, string>;

function p<T extends object>(b: T): T & { clientOperationId: string } {
  return { clientOperationId: uuid(), ...b };
}

async function httpSession(targetApp: any, userId = 'demo-admin') {
  let r = await inject(targetApp, { url: '/api/v1/session' });
  let cookie = r.headers['set-cookie'][0].split(';')[0];
  r = await inject(targetApp, {
    method: 'POST',
    url: '/api/v1/auth/demo',
    headers: { cookie, 'x-csrf-token': r.body.csrf },
    body: { userId },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  cookie = r.headers['set-cookie'][0].split(';')[0];
  r = await inject(targetApp, { url: '/api/v1/session', headers: { cookie } });
  return {
    cookie,
    'x-csrf-token': r.body.csrf,
    'x-company-context': 'demo',
    'x-warehouse-context': 'demo:legacy',
  };
}

const adminActor = {
  id: 'demo-admin',
  org_id: 'demo',
  role: 'administrator' as const,
  warehouse_id: 'demo:legacy',
  name: 'Demo Admin',
  email: 'admin@demo.test',
};

const supervisorActor = {
  id: 'demo-admin',
  org_id: 'demo',
  role: 'administrator' as const,
  warehouse_id: 'demo:legacy',
  name: 'Demo Admin',
  email: 'admin@demo.test',
};

const operatorActor = {
  id: 'demo-operator',
  org_id: 'demo',
  role: 'operator' as const,
  warehouse_id: 'demo:legacy',
  name: 'Demo Operator',
  email: 'operator@demo.test',
};

const driverActor = {
  id: 'demo-driver',
  org_id: 'demo',
  role: 'driver' as const,
  warehouse_id: 'demo:legacy',
  name: 'Demo Driver',
  email: 'driver@demo.test',
};

before(async () => {
  uploadsDir = await mkdtemp(path.join(os.tmpdir(), 'jadesun-p1-daily-work-'));
  db = await openDatabase(null, ':memory:');
  await migrate(db);
  await seed(db);
  app = createApp(db, { uploads: uploadsDir, demo: true });

  adminHeaders = await httpSession(app, 'demo-admin');
  supervisorHeaders = adminHeaders;
  operatorHeaders = await httpSession(app, 'demo-operator');
  driverHeaders = await httpSession(app, 'demo-driver');
});

after(async () => {
  await rm(uploadsDir, { recursive: true, force: true }).catch(() => {});
});

// =========================================================================
// 1. Warehouse Tasks and Shift Handover
// =========================================================================
test('P1.1 Tasks & Shift Handover: priority, due time, concurrency claim/reassign, blocked reason, no stock mutation on complete', async () => {
  // 1. Create a task with priority and due time
  const taskId = uuid();
  const dueAt = new Date(Date.now() + 3600000).toISOString();
  await db.query(
    `INSERT INTO warehouse_tasks(id, org_id, warehouse_id, kind, product_id, source_location_id, destination_location_id, quantity, unit, priority, due_at, status, version)
     VALUES($1, 'demo', 'demo:legacy', 'picking', 'p1', 'l1', 'l2', 10, 'piece', 1, $2, 'pending', 1)`,
    [taskId, dueAt],
  );

  // 2. Claim task with operator
  const claimed = await claimTask(db, operatorActor, taskId, p({
    expectedVersion: 1,
  }));
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.assigned_user_id, operatorActor.id);
  assert.equal(claimed.claimed_by, operatorActor.id);
  assert.ok(claimed.claimed_at);

  // 3. Stale version concurrency check on reassign
  await assert.rejects(
    () => reassignTask(db, supervisorActor, taskId, p({
      expectedVersion: 1, // Stale!
      userId: 'demo-admin',
      reason: 'Reassign to lead worker',
    })),
    /This record changed|VERSION_CONFLICT|409/,
  );

  // 4. Successful reassign with correct version
  const reassigned = await reassignTask(db, supervisorActor, taskId, p({
    expectedVersion: claimed.version,
    userId: 'demo-admin',
    reason: 'Shift rebalancing',
  }));
  assert.equal(reassigned.assigned_user_id, 'demo-admin');

  // 5. Start task
  const started = await startTask(db, supervisorActor, taskId, p({
    expectedVersion: reassigned.version,
  }));
  assert.equal(started.status, 'in_progress');
  assert.ok(started.started_at);

  // 6. Block task with required blocked reason
  const blocked = await blockTask(db, supervisorActor, taskId, p({
    expectedVersion: started.version,
    reason: 'Aisle 3 blocked by forklift maintenance',
  }));
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.blocked_reason, 'Aisle 3 blocked by forklift maintenance');

  // 7. Unblock / restart and complete task
  const unblocked = await startTask(db, supervisorActor, taskId, p({
    expectedVersion: blocked.version,
  }));
  assert.equal(unblocked.status, 'in_progress');
  assert.equal(unblocked.blocked_reason, null);

  // Invariant: Completing a task does not itself mutate stock; actual domain command succeeds
  const boxCountBefore = (await db.query("SELECT count(*)::int n FROM boxes WHERE org_id='demo'")).rows[0].n;
  const balanceBefore = (await db.query("SELECT * FROM inventory_balances WHERE org_id='demo' AND product_id='p1' AND location_id='l1'")).rows[0];

  const execRef = uuid();
  const completed = await inject(app, {
    method: 'POST',
    url: `/api/v1/tasks/${taskId}/complete`,
    headers: adminHeaders,
    body: p({
      expectedVersion: unblocked.version,
      scanConfirmation: 'p1',
      executionReferenceId: execRef,
    }),
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.status, 'completed');
  assert.equal(completed.body.execution_reference_id, execRef);

  // Verify stock was NOT mutated by task completion alone
  const boxCountAfter = (await db.query("SELECT count(*)::int n FROM boxes WHERE org_id='demo'")).rows[0].n;
  assert.equal(boxCountAfter, boxCountBefore);
  if (balanceBefore) {
    const balanceAfter = (await db.query("SELECT * FROM inventory_balances WHERE id=$1", [balanceBefore.id])).rows[0];
    assert.equal(balanceAfter.on_hand, balanceBefore.on_hand);
  }

  // 8. Shift Handover: create and acknowledge
  const handoverRes = await inject(app, {
    method: 'POST',
    url: '/api/v1/shift-handovers',
    headers: operatorHeaders,
    body: p({
      shiftName: 'Morning Shift -> Evening Shift',
      handoverDate: new Date().toISOString().slice(0, 10),
      incomingUserId: 'demo-admin',
      notes: 'Dock 2 inbound cleared. Aisle 3 maintenance complete.',
      pendingTasks: [taskId],
      blockedTasks: [],
    }),
  });
  assert.equal(handoverRes.status, 200);
  const handoverId = handoverRes.body.id;
  assert.equal(handoverRes.body.shift_name, 'Morning Shift -> Evening Shift');
  assert.equal(handoverRes.body.acknowledged_at, null);

  // Acknowledge handover by incoming user
  const ackRes = await inject(app, {
    method: 'POST',
    url: `/api/v1/shift-handovers/${handoverId}/acknowledge`,
    headers: adminHeaders,
    body: p({
      expectedVersion: handoverRes.body.version,
      notes: 'Handover received and verified.',
    }),
  });
  assert.equal(ackRes.status, 200);
  assert.ok(ackRes.body.acknowledged_at);

  // List handovers
  const listHandovers = await inject(app, {
    method: 'GET',
    url: '/api/v1/shift-handovers',
    headers: operatorHeaders,
  });
  assert.equal(listHandovers.status, 200);
  assert.ok(Array.isArray(listHandovers.body));
  assert.ok(listHandovers.body.some((h: any) => h.id === handoverId));
});

// =========================================================================
// 2. Picking Exceptions & Totes
// =========================================================================
test('P1.2 Picking Exceptions: tote registration, source/lot verification, shortages, authorized substitutions vs silent rejection', async () => {
  // 1. Register identified picking tote
  const toteCode = 'TOTE-' + uuid().slice(0, 6).toUpperCase();
  const toteRes = await inject(app, {
    method: 'POST',
    url: '/api/v1/picking/totes',
    headers: operatorHeaders,
    body: p({ code: toteCode }),
  });
  assert.equal(toteRes.status, 200);
  const toteId = toteRes.body.id;
  assert.equal(toteRes.body.code, toteCode);

  // 2. Create order with 2 lines for picking test (c1 -> d1, p1 piece, p3 piece)
  const orderRes = await inject(app, {
    method: 'POST',
    url: '/api/v1/orders',
    headers: adminHeaders,
    body: p({
      customerId: 'c1',
      destinationId: 'd1',
      lines: [
        { productId: 'p1', quantity: '10', unit: 'piece' },
        { productId: 'p3', quantity: '5', unit: 'piece' },
      ],
    }),
  });
  assert.equal(orderRes.status, 200);
  const orderId = orderRes.body.id;
  const orderLines = (await db.query("SELECT * FROM order_lines WHERE order_id=$1", [orderId])).rows;
  const line1 = orderLines.find((l: any) => l.product_id === 'p1');
  const line2 = orderLines.find((l: any) => l.product_id === 'p3');

  // 3. Normal pick verification into tote with explicit source, product, lot
  const pick1 = await inject(app, {
    method: 'POST',
    url: '/api/v1/picking/verify',
    headers: operatorHeaders,
    body: p({
      orderId,
      orderLineId: line1.id,
      toteId,
      sourceLocationId: 'l1',
      productId: 'p1',
      quantityPicked: '10',
      quantityRequested: '10',
    }),
  });
  assert.equal(pick1.status, 200);
  assert.equal(pick1.body.status, 'verified');
  assert.equal(new Decimal(pick1.body.shortage_quantity).toFixed(), '0');
  assert.equal(pick1.body.is_substitution, false);

  // 4. Shortage pick verification: picked 3 out of 5
  const pick2Shortage = await inject(app, {
    method: 'POST',
    url: '/api/v1/picking/verify',
    headers: operatorHeaders,
    body: p({
      orderId,
      orderLineId: line2.id,
      toteId,
      sourceLocationId: 'l1',
      productId: 'p3',
      quantityPicked: '3',
      quantityRequested: '5',
    }),
  });
  assert.equal(pick2Shortage.status, 200);
  assert.equal(pick2Shortage.body.status, 'shortage');
  assert.equal(new Decimal(pick2Shortage.body.shortage_quantity).toFixed(), '2');

  // 5. Silent substitution MUST be rejected (no silent substitutions!)
  const silentSub = await inject(app, {
    method: 'POST',
    url: '/api/v1/picking/verify',
    headers: operatorHeaders,
    body: p({
      orderId,
      orderLineId: line2.id,
      toteId,
      sourceLocationId: 'l1',
      productId: 'p1', // Different from requested p3, but isSubstitution is false!
      quantityPicked: '2',
      quantityRequested: '2',
      isSubstitution: false,
    }),
  });
  assert.equal(silentSub.status, 422);
  assert.equal(silentSub.body.error.code, 'PRODUCT_MISMATCH');

  // 6. Unauthorized substitution by operator MUST fail
  const unauthSub = await inject(app, {
    method: 'POST',
    url: '/api/v1/picking/verify',
    headers: operatorHeaders, // Operator cannot authorize substitution!
    body: p({
      orderId,
      orderLineId: line2.id,
      toteId,
      sourceLocationId: 'l1',
      productId: 'p3',
      quantityPicked: '2',
      quantityRequested: '2',
      isSubstitution: true,
      substitutedProductId: 'p1',
      substitutionReason: 'p3 shortage, substituting equivalent p1 piece',
    }),
  });
  assert.equal(unauthSub.status, 403);
  assert.equal(unauthSub.body.error.code, 'FORBIDDEN');

  // 7. Supervisor-authorized substitution succeeds and preserves requested + substituted
  const authSub = await inject(app, {
    method: 'POST',
    url: '/api/v1/picking/verify',
    headers: adminHeaders, // Administrator/Supervisor
    body: p({
      orderId,
      orderLineId: line2.id,
      toteId,
      sourceLocationId: 'l1',
      productId: 'p3',
      quantityPicked: '2',
      quantityRequested: '2',
      isSubstitution: true,
      substitutedProductId: 'p1',
      substitutionReason: 'Customer approved equivalent grade p1',
    }),
  });
  assert.equal(authSub.status, 200);
  assert.equal(authSub.body.is_substitution, true);
  assert.equal(authSub.body.product_id, 'p3'); // Preserves requested product
  assert.equal(authSub.body.substituted_product_id, 'p1'); // Preserves substituted product
  assert.equal(authSub.body.substitution_reason, 'Customer approved equivalent grade p1');
  assert.equal(authSub.body.authorized_by, adminActor.id);

  // List picking verifications for order
  const verifs = await inject(app, {
    method: 'GET',
    url: `/api/v1/picking/verifications/${orderId}`,
    headers: operatorHeaders,
  });
  assert.equal(verifs.status, 200);
  assert.equal(verifs.body.length, 3);
});

// =========================================================================
// 3. Packing & Changing Checked Work: Split/Repack & Cascade Invalidation
// =========================================================================
test('P1.3 Packing & Changing Checked Work: package split quantity & catch weight conservation, manifest invalidation cascade', async () => {
  // 1. Receive a box with 20 pieces, catch weight 45.500000 kg, package count 4 (c1, l1)
  const box = await services.receipt(db, adminActor, {
    clientOperationId: uuid(),
    customerId: 'c1',
    locationId: 'l1',
    sourceLabel: 'Inbound Batch #7721',
    condition: 'good',
    contents: [
      {
        productId: 'p1',
        quantity: '20',
        unit: 'piece',
        verified: true,
        catchWeight: '45.500000',
        packageCount: 4,
      },
    ],
  });

  const origContents = (await db.query("SELECT * FROM contents WHERE box_id=$1", [box.id])).rows[0];

  // 2. Split package into 8 pieces, catch weight 18.200000 kg, package count 2
  const splitRes = await inject(app, {
    method: 'POST',
    url: `/api/v1/boxes/${box.id}/split`,
    headers: adminHeaders,
    body: p({
      expectedVersion: box.version,
      contentsId: origContents.id,
      quantity: '8',
      locationId: 'l2',
      catchWeight: '18.200000',
      packageCount: 2,
      reason: 'Split partial order demand for customer pickup',
    }),
  });
  assert.equal(splitRes.status, 200);
  const { source, created } = splitRes.body;

  // Verify conservation of total quantity, catch weight, and package count:
  const sourceContents = (await db.query("SELECT * FROM contents WHERE box_id=$1", [source.id])).rows[0];
  const createdContents = (await db.query("SELECT * FROM contents WHERE box_id=$1", [created.id])).rows[0];

  const totalQty = new Decimal(sourceContents.quantity).plus(createdContents.quantity);
  assert.equal(totalQty.toFixed(), '20');
  assert.equal(sourceContents.quantity, '12.000000');
  assert.equal(createdContents.quantity, '8.000000');

  const totalCw = new Decimal(sourceContents.catch_weight).plus(createdContents.catch_weight);
  assert.equal(totalCw.toFixed(6), '45.500000');
  assert.equal(sourceContents.catch_weight, '27.300000');
  assert.equal(createdContents.catch_weight, '18.200000');

  const totalPc = Number(sourceContents.package_count) + Number(createdContents.package_count);
  assert.equal(totalPc, 4);
  assert.equal(sourceContents.package_count, 2);
  assert.equal(createdContents.package_count, 2);

  // 3. Test Invalidation Cascade:
  // Put box on pallet (must set location_id=NULL to preserve standalone vs pallet location constraint)
  const palletId = uuid();
  await db.query(
    "INSERT INTO pallets(id, org_id, warehouse_id, code, location_id, manifest_revision, checked_revision, version) VALUES($1, 'demo', 'demo:legacy', 'PAL-TEST-01', 'l1', 1, 1, 1)",
    [palletId],
  );
  await db.query("UPDATE boxes SET pallet_id=$1, location_id=NULL WHERE id=$2", [palletId, source.id]);

  // Order & prep batch
  const orderRes = await inject(app, {
    method: 'POST',
    url: '/api/v1/orders',
    headers: adminHeaders,
    body: p({
      customerId: 'c1',
      destinationId: 'd1',
      lines: [{ productId: 'p1', quantity: '12', unit: 'piece' }],
    }),
  });
  const orderId = orderRes.body.id;
  const orderLines = (await db.query("SELECT * FROM order_lines WHERE order_id=$1", [orderId])).rows;
  await db.query(
    "INSERT INTO allocations(id, org_id, warehouse_id, box_id, contents_id, order_id, order_line_id, quantity) VALUES($1, 'demo', 'demo:legacy', $2, $3, $4, $5, 12)",
    [uuid(), source.id, sourceContents.id, orderId, orderLines[0].id],
  );

  const prepBatch = await services.preparation(db, adminActor, p({
    businessDate: '2026-11-04',
    orderIds: [orderId],
  }));

  // Advance prep order to checked and ready
  await db.query(
    "UPDATE preparation_orders SET checked=true, stage='ready' WHERE preparation_id=$1 AND order_id=$2",
    [prepBatch.id, orderId],
  );

  // Create planned shipment
  const shipmentId = uuid();
  await db.query(
    "INSERT INTO shipments(id, org_id, warehouse_id, order_id, destination_id, status, version) VALUES($1, 'demo', 'demo:legacy', $2, 'd1', 'ready', 1)",
    [shipmentId, orderId],
  );

  // Pallet was checked (manifest_revision = checked_revision = 1)
  const palletBefore = (await db.query("SELECT * FROM pallets WHERE id=$1", [palletId])).rows[0];
  assert.equal(palletBefore.checked_revision, 1);

  // Now, modify/repack the box on this pallet!
  const curSource = await boxState(db, adminActor, source.id);
  const repackRes = await inject(app, {
    method: 'POST',
    url: `/api/v1/boxes/${source.id}/repack`,
    headers: adminHeaders,
    body: p({
      expectedVersion: curSource.version,
      contentsId: sourceContents.id,
      quantity: '5',
      locationId: 'l1',
      reason: 'Partial repack for damaged packaging',
    }),
  });
  assert.equal(repackRes.status, 200);

  // Verify CASCADE INVALIDATION:
  // 1. Pallet checked_revision must be reset to NULL
  const palletAfter = (await db.query("SELECT * FROM pallets WHERE id=$1", [palletId])).rows[0];
  assert.equal(palletAfter.checked_revision, null);
  assert.ok(palletAfter.manifest_revision > palletBefore.manifest_revision);

  // 2. Preparation order must have checked = false and stage reset from ready to checking
  const prepOrderAfter = (await db.query("SELECT * FROM preparation_orders WHERE preparation_id=$1 AND order_id=$2", [prepBatch.id, orderId])).rows[0];
  assert.equal(prepOrderAfter.checked, false);
  assert.equal(prepOrderAfter.stage, 'checking');

  // 3. Shipment must be reset to 'needs_recheck'
  const shipmentAfter = (await db.query("SELECT * FROM shipments WHERE id=$1", [shipmentId])).rows[0];
  assert.equal(shipmentAfter.status, 'needs_recheck');
});

// =========================================================================
// 4. Pallet Group to Shipment Review & Loading Workflow
// =========================================================================
test('P1.4 Pallet Group Loading: stopping incorrect shipments, approved mixed customers, multiple pallets per trip/destination', async () => {
  // 1. Create a trip with planned status
  const trip = await services.trip(db, adminActor, p({
    businessDate: '2026-11-05',
    driverId: 'demo-driver',
    vehicle: 'TRUCK-01',
    shipmentIds: [],
  }));

  const destId = 'd1';

  // Authorize customer c2 for destination d1 (mixing approved customers at destination)
  await db.query(
    "INSERT INTO destination_authorizations(id, org_id, customer_id, destination_id, reason) VALUES($1, 'demo', 'c2', 'd1', 'Shared receiving dock authorized') ON CONFLICT DO NOTHING",
    [uuid()],
  );

  // Create two orders for two different customers at the same destination
  const order1 = await services.order(db, adminActor, p({
    customerId: 'c1',
    destinationId: destId,
    lines: [{ productId: 'p1', quantity: '5', unit: 'piece' }],
  }));
  const order2 = await services.order(db, adminActor, p({
    customerId: 'c2',
    destinationId: destId,
    lines: [{ productId: 'p3', quantity: '3', unit: 'piece' }],
  }));

  // Create boxes for both orders
  const box1 = await services.receipt(db, adminActor, {
    clientOperationId: uuid(),
    customerId: 'c1',
    locationId: 'l1',
    sourceLabel: 'Order 1 box',
    condition: 'good',
    contents: [{ productId: 'p1', quantity: '5', unit: 'piece', verified: true }],
  });
  const box2 = await services.receipt(db, adminActor, {
    clientOperationId: uuid(),
    customerId: 'c2',
    locationId: 'l1',
    sourceLabel: 'Order 2 box',
    condition: 'good',
    contents: [{ productId: 'p3', quantity: '3', unit: 'piece', verified: true }],
  });

  // Create 2 independent pallets and place boxes on them (location_id=NULL when on pallet)
  const pal1 = (await db.query(
    "INSERT INTO pallets(id, org_id, warehouse_id, code, location_id, manifest_revision, checked_revision, version) VALUES($1, 'demo', 'demo:legacy', 'PAL-GRP-1', 'l1', 1, 1, 1) RETURNING *",
    [uuid()],
  )).rows[0];
  const pal2 = (await db.query(
    "INSERT INTO pallets(id, org_id, warehouse_id, code, location_id, manifest_revision, checked_revision, version) VALUES($1, 'demo', 'demo:legacy', 'PAL-GRP-2', 'l1', 1, 1, 1) RETURNING *",
    [uuid()],
  )).rows[0];

  await db.query("UPDATE boxes SET pallet_id=$1, location_id=NULL WHERE id=$2", [pal1.id, box1.id]);
  await db.query("UPDATE boxes SET pallet_id=$1, location_id=NULL WHERE id=$2", [pal2.id, box2.id]);

  // Create shipments for trip
  const ship1 = (await db.query(
    "INSERT INTO shipments(id, org_id, warehouse_id, order_id, destination_id, trip_id, status, version) VALUES($1, 'demo', 'demo:legacy', $2, $3, $4, 'ready', 1) RETURNING *",
    [uuid(), order1.id, destId, trip.id],
  )).rows[0];
  const ship2 = (await db.query(
    "INSERT INTO shipments(id, org_id, warehouse_id, order_id, destination_id, trip_id, status, version) VALUES($1, 'demo', 'demo:legacy', $2, $3, $4, 'ready', 1) RETURNING *",
    [uuid(), order2.id, destId, trip.id],
  )).rows[0];

  // Insert shipment lines for both boxes
  await db.query(
    "INSERT INTO shipment_lines(id, org_id, warehouse_id, shipment_id, box_id, product_id, quantity, unit, loaded) VALUES($1, 'demo', 'demo:legacy', $2, $3, 'p1', 5, 'piece', false)",
    [uuid(), ship1.id, box1.id],
  );
  await db.query(
    "INSERT INTO shipment_lines(id, org_id, warehouse_id, shipment_id, box_id, product_id, quantity, unit, loaded) VALUES($1, 'demo', 'demo:legacy', $2, $3, 'p3', 3, 'piece', false)",
    [uuid(), ship2.id, box2.id],
  );

  // 3. Create pallet group containing both pallets for this trip
  const grp = await createPalletGroup(db, adminActor, p({
    tripId: trip.id,
    name: 'Morning Pallet Group #1',
    reason: 'Consolidating pallets for Stop 1',
  }));
  await changePalletGroup(db, adminActor, grp.id, p({
    expectedVersion: grp.version,
    palletId: pal1.id,
    reason: 'Add pallet 1',
  }), false);
  const grpWithPal1 = (await db.query("SELECT * FROM pallet_groups WHERE id=$1", [grp.id])).rows[0];
  await changePalletGroup(db, adminActor, grp.id, p({
    expectedVersion: grpWithPal1.version,
    palletId: pal2.id,
    reason: 'Add pallet 2',
  }), false);

  // Invariant check: Grouping never means physical nesting; review itself is not load approval
  const pal1Check = (await db.query("SELECT * FROM pallets WHERE id=$1", [pal1.id])).rows[0];
  const pal2Check = (await db.query("SELECT * FROM pallets WHERE id=$1", [pal2.id])).rows[0];
  assert.equal(pal1Check.location_id, 'l1');
  assert.equal(pal2Check.location_id, 'l1');

  // 4. Test Stopping Incorrect Shipments:
  // If a pallet has unchecked manifest changes, loading workflow must halt!
  await db.query("UPDATE pallets SET checked_revision=NULL WHERE id=$1", [pal1.id]);
  const grpCur = (await db.query("SELECT * FROM pallet_groups WHERE id=$1", [grp.id])).rows[0];
  await assert.rejects(
    () => loadPalletGroupWorkflow(db, adminActor, grp.id, p({
      expectedVersion: grpCur.version,
      tripId: trip.id,
    })),
    /Pallet manifest is unchecked|PREPARATION_CHECK_REQUIRED|409/,
  );

  // Restore check on pallet 1
  await db.query("UPDATE pallets SET checked_revision=manifest_revision WHERE id=$1", [pal1.id]);

  // 5. Successful End-to-End Loading Workflow:
  const loadRes = await inject(app, {
    method: 'POST',
    url: `/api/v1/pallet-groups/${grp.id}/load`,
    headers: adminHeaders,
    body: p({
      expectedVersion: grpCur.version,
      tripId: trip.id,
      recipientType: 'final_recipient',
      recipientName: 'Manager Alice',
    }),
  });
  assert.equal(loadRes.status, 200);
  assert.equal(loadRes.body.loaded, true);
  assert.equal(loadRes.body.loadedBoxesCount, 2);

  // Verify all shipment lines for these boxes are marked loaded
  const linesLoaded = (await db.query("SELECT loaded FROM shipment_lines WHERE box_id IN ($1, $2)", [box1.id, box2.id])).rows;
  assert.ok(linesLoaded.every((l) => l.loaded === true));

  // Verify recipient metadata recorded
  const updatedShipment = (await db.query("SELECT * FROM shipments WHERE id=$1", [ship1.id])).rows[0];
  assert.equal(updatedShipment.recipient_type, 'final_recipient');
  assert.equal(updatedShipment.recipient_name, 'Manager Alice');
});

// =========================================================================
// 5. Stop-specific Delivery & Transport Custody
// =========================================================================
test('P1.5 Stop-specific Delivery & Custody: driver reassignment history, failed delivery to hold, reverse collection at stop', async () => {
  // 1. Create a trip with demo-driver
  const trip = await services.trip(db, adminActor, p({
    businessDate: '2026-11-06',
    driverId: 'demo-driver',
    vehicle: 'VAN-09',
    shipmentIds: [],
  }));

  // Reassign trip driver with full history tracking
  const reassignRes = await inject(app, {
    method: 'POST',
    url: `/api/v1/trips/${trip.id}/reassign-driver`,
    headers: adminHeaders,
    body: p({
      expectedVersion: trip.version,
      newDriverId: 'demo-driver',
      reason: 'Driver shift swap due to route change',
    }),
  });
  assert.equal(reassignRes.status, 200);

  // Check driver reassignment audit history
  const historyRes = await inject(app, {
    method: 'GET',
    url: `/api/v1/trips/${trip.id}/reassignments`,
    headers: adminHeaders,
  });
  assert.equal(historyRes.status, 200);
  assert.ok(historyRes.body.length >= 1);
  assert.equal(historyRes.body[0].reason, 'Driver shift swap due to route change');

  // 2. Create box, order, and shipment in 'dispatched' delivery custody (c1, d1, p1 piece)
  const box = await services.receipt(db, adminActor, {
    clientOperationId: uuid(),
    customerId: 'c1',
    locationId: 'l1',
    sourceLabel: 'Delivery Custody Box',
    condition: 'good',
    contents: [{ productId: 'p1', quantity: '10', unit: 'piece', verified: true }],
  });
  await db.query("UPDATE boxes SET status='dispatched' WHERE id=$1", [box.id]);

  const order = await services.order(db, adminActor, p({
    customerId: 'c1',
    destinationId: 'd1',
    lines: [{ productId: 'p1', quantity: '10', unit: 'piece' }],
  }));

  const shipment = (await db.query(
    "INSERT INTO shipments(id, org_id, warehouse_id, order_id, destination_id, trip_id, status, version) VALUES($1, 'demo', 'demo:legacy', $2, 'd1', $3, 'dispatched', 1) RETURNING *",
    [uuid(), order.id, trip.id],
  )).rows[0];

  await db.query(
    "INSERT INTO shipment_lines(id, org_id, warehouse_id, shipment_id, box_id, product_id, quantity, unit, delivered, returned, loaded) VALUES($1, 'demo', 'demo:legacy', $2, $3, 'p1', 10, 'piece', 0, 0, true)",
    [uuid(), shipment.id, box.id],
  );

  // 3. Failed delivery: Customer closed / refused
  // Undelivered goods MUST return to hold with issues reported
  const failRes = await inject(app, {
    method: 'POST',
    url: `/api/v1/shipments/${shipment.id}/fail-delivery`,
    headers: driverHeaders, // Driver on route can fail stop delivery
    body: p({
      expectedVersion: shipment.version,
      reason: 'customer_refused',
      note: 'Premises closed, notice card left',
    }),
  });
  assert.equal(failRes.status, 200);
  assert.equal(failRes.body.status, 'failed');

  // Box must now be status = 'returned', condition = 'hold'
  const boxAfterFail = (await db.query("SELECT * FROM boxes WHERE id=$1", [box.id])).rows[0];
  assert.equal(boxAfterFail.status, 'returned');
  assert.equal(boxAfterFail.condition, 'hold');

  // Issue must have been created for failed delivery
  const issue = (await db.query("SELECT * FROM issues WHERE box_id=$1", [box.id])).rows[0];
  assert.ok(issue);
  assert.equal(issue.kind, 'failed_delivery');

  // 4. Reverse collection at stop:
  await db.query("UPDATE trips SET status='in_progress' WHERE id=$1", [trip.id]);
  const stopId = uuid();

  const collectRes = await inject(app, {
    method: 'POST',
    url: `/api/v1/trips/${trip.id}/collect-return`,
    headers: driverHeaders,
    body: p({
      stopId,
      customerId: 'c1',
      productId: 'p1',
      quantity: '4',
      unit: 'piece',
      reason: 'Customer return of expired stock from prior delivery',
    }),
  });
  assert.equal(collectRes.status, 200);
  const collectedBox = collectRes.body.box;
  assert.equal(collectedBox.status, 'returned');
  assert.equal(collectedBox.condition, 'hold');

  // Verify return disposition issue attached
  const collectIssue = (await db.query("SELECT * FROM issues WHERE box_id=$1", [collectedBox.id])).rows[0];
  assert.ok(collectIssue);
  assert.equal(collectIssue.kind, 'return disposition');
});

// =========================================================================
// 6. Staff-only Order Sheet & Customer Documents (Gated Commercial/Tax Terms)
// =========================================================================
test('P1.6 Documents: staff order sheet preserved, gating commercial/tax invoices & labels, unverified historical prices rejected', async () => {
  const order = await services.order(db, adminActor, p({
    customerId: 'c1',
    destinationId: 'd1',
    lines: [{ productId: 'p1', quantity: '6', unit: 'piece' }],
  }));

  const shipment = (await db.query(
    "INSERT INTO shipments(id, org_id, warehouse_id, order_id, destination_id, status, version) VALUES($1, 'demo', 'demo:legacy', $2, 'd1', 'ready', 1) RETURNING *",
    [uuid(), order.id],
  )).rows[0];

  // 1. Staff-only order sheet remains available and strictly read-only
  const staffSheet = await inject(app, {
    method: 'GET',
    url: `/api/v1/orders/${order.id}/worker-sheet`,
    headers: operatorHeaders,
  });
  assert.equal(staffSheet.status, 200);
  const staffHtml = staffSheet.raw.toString('utf8');
  assert.ok(staffHtml.includes('Warehouse worker order sheet'));

  // 2. Physical-only customer delivery note succeeds and contains explicit pricing disclaimer
  const deliveryNote = await inject(app, {
    method: 'GET',
    url: `/api/v1/documents/customer-delivery-note/${shipment.id}`,
    headers: operatorHeaders,
  });
  assert.equal(deliveryNote.status, 200);
  const deliveryNoteHtml = deliveryNote.raw.toString('utf8');
  assert.ok(deliveryNoteHtml.includes('PHYSICAL QUANTITIES ONLY · COMMERCIAL PRICING UNCONFIRMED'));
  assert.ok(deliveryNoteHtml.includes('HISTORICAL PRICES NOT APPLIED'));

  // 3. Requesting commercial pricing / tax terms on delivery note MUST fail with 422
  const commercialNote = await inject(app, {
    method: 'GET',
    url: `/api/v1/documents/customer-delivery-note/${shipment.id}?confirmCommercialTerms=true`,
    headers: operatorHeaders,
  });
  assert.equal(commercialNote.status, 422);
  assert.equal(commercialNote.body.error.code, 'COMMERCIAL_REQUIREMENTS_UNCONFIRMED');

  // 4. Customer tax invoice MUST fail with 422 COMMERCIAL_REQUIREMENTS_UNCONFIRMED
  const invoiceRes = await inject(app, {
    method: 'GET',
    url: `/api/v1/documents/customer-invoice/${shipment.id}`,
    headers: adminHeaders,
  });
  assert.equal(invoiceRes.status, 422);
  assert.equal(invoiceRes.body.error.code, 'COMMERCIAL_REQUIREMENTS_UNCONFIRMED');

  // 5. Recipient pallet labels with commercial terms requested MUST fail with 422
  const labelsRes = await inject(app, {
    method: 'GET',
    url: `/api/v1/documents/recipient-pallet-labels/${shipment.id}?confirmCommercialTerms=true`,
    headers: adminHeaders,
  });
  assert.equal(labelsRes.status, 422);
  assert.equal(labelsRes.body.error.code, 'COMMERCIAL_REQUIREMENTS_UNCONFIRMED');
});

// =========================================================================
// 7. Cancellation, Backorder and Reconciliation
// =========================================================================
test('P1.7 Cancellation & Backorder Reconciliation: release allocation, unpack boxes, backorder visibility, compensating event', async () => {
  // 1. Create order with 10 units
  const order = await services.order(db, adminActor, p({
    customerId: 'c1',
    destinationId: 'd1',
    lines: [{ productId: 'p1', quantity: '10', unit: 'piece' }],
  }));
  const orderLines = (await db.query("SELECT * FROM order_lines WHERE order_id=$1", [order.id])).rows;

  // 2. Receive and allocate box of 6 units (partial allocation)
  const box = await services.receipt(db, adminActor, {
    clientOperationId: uuid(),
    customerId: 'c1',
    locationId: 'l1',
    sourceLabel: 'Partial order box',
    condition: 'good',
    contents: [{ productId: 'p1', quantity: '6', unit: 'piece', verified: true }],
  });
  await services.allocate(db, adminActor, order.id, p({
    expectedVersion: order.version,
    boxId: box.id,
    orderLineId: orderLines[0].id,
    quantity: '6',
  }));

  // Create planned shipment
  const shipment = (await db.query(
    "INSERT INTO shipments(id, org_id, warehouse_id, order_id, destination_id, status, version) VALUES($1, 'demo', 'demo:legacy', $2, 'd1', 'ready', 1) RETURNING *",
    [uuid(), order.id],
  )).rows[0];
  await db.query(
    "INSERT INTO shipment_lines(id, org_id, warehouse_id, shipment_id, box_id, product_id, quantity, unit, loaded) VALUES($1, 'demo', 'demo:legacy', $2, $3, 'p1', 6, 'piece', false)",
    [uuid(), shipment.id, box.id],
  );

  // 3. Operator cannot perform reconciled cancellation (supervisor authorization required)
  const opCancel = await inject(app, {
    method: 'POST',
    url: `/api/v1/orders/${order.id}/cancel-reconcile`,
    headers: operatorHeaders,
    body: p({
      expectedVersion: 2,
      reason: 'Customer requested order cancellation',
      createBackorder: true,
    }),
  });
  assert.equal(opCancel.status, 403);

  // 4. Supervisor performs reconciled order cancellation
  const supCancel = await inject(app, {
    method: 'POST',
    url: `/api/v1/orders/${order.id}/cancel-reconcile`,
    headers: adminHeaders,
    body: p({
      expectedVersion: 2,
      reason: 'Customer requested order cancellation due to delayed schedule',
      createBackorder: true,
    }),
  });
  assert.equal(supCancel.status, 200);
  assert.equal(supCancel.body.status, 'cancelled');

  // Verify allocations released
  const remainingAllocations = (await db.query("SELECT * FROM allocations WHERE order_id=$1", [order.id])).rows;
  assert.equal(remainingAllocations.length, 0);

  // Verify shipment cancelled
  const updatedShipment = (await db.query("SELECT * FROM shipments WHERE id=$1", [shipment.id])).rows[0];
  assert.equal(updatedShipment.status, 'cancelled');

  // Verify backorders recorded for unfulfilled demand (10 requested - 6 allocated = 4 unfulfilled)
  const backorders = await inject(app, {
    method: 'GET',
    url: `/api/v1/orders/backorders?orderId=${order.id}`,
    headers: adminHeaders,
  });
  assert.equal(backorders.status, 200);
  assert.ok(backorders.body.length >= 1);
  assert.equal(backorders.body[0].backorder_quantity, '4.000000');
  assert.equal(backorders.body[0].requested_quantity, '10.000000');
  assert.equal(backorders.body[0].fulfilled_quantity, '6.000000');

  // Verify append-only compensating event recorded
  const events = (await db.query("SELECT * FROM inventory_events WHERE entity_id=$1 AND kind='order.reconciled_cancellation'", [order.id])).rows;
  assert.ok(events.length >= 1);
  const eventData = events[0].data || events[0].payload;
  assert.equal(eventData.cancelledAllocationsCount, 1);
  assert.equal(eventData.backorderCreated, true);
});

// =========================================================================
// 8. Configurable Preparation Schedules (Multi-company proof)
// =========================================================================
test('P1.8 Configurable Preparation Schedules: prove another company chooses different days, empty batches only, Wednesday stays JadeSun', async () => {
  // 1. Verify JadeSun (demo company) preparation weekdays defaults to Wednesday [3]
  const jadeSunCfg = (await db.query("SELECT preparation_weekdays FROM company_configuration WHERE org_id='demo'")).rows[0];
  assert.deepEqual(jadeSunCfg.preparation_weekdays, [3]);

  // JadeSun schedule suggestions return Wednesdays only
  const jadeSunSuggestions = await suggestPreparationBatches(db, adminActor, '2026-11-01', 4);
  assert.ok(jadeSunSuggestions.length === 4);
  assert.ok(jadeSunSuggestions.every((s) => s.weekday === 3)); // 3 = Wednesday
  assert.ok(jadeSunSuggestions.every((s) => s.emptyBatch === true && s.orderIds.length === 0));

  // 2. Setup a second company 'comp-b' with different schedule: Monday & Thursday [1, 4]
  await db.query("INSERT INTO organizations(id, name, demo) VALUES('comp-b', 'Company B Logistics', true) ON CONFLICT DO NOTHING");
  await db.query(
    "INSERT INTO warehouses(id, org_id, code, name) VALUES('comp-b:wh1', 'comp-b', 'WH-B1', 'Company B Warehouse 1') ON CONFLICT DO NOTHING",
  );
  await db.query(
    "INSERT INTO company_configuration(org_id, display_name, operating_profile, timezone, language, date_format, preparation_weekdays, version) VALUES('comp-b', 'Company B Logistics', 'wholesale', 'Europe/London', 'en', 'day-first', ARRAY[1, 4]::smallint[], 1) ON CONFLICT (org_id) DO UPDATE SET preparation_weekdays=ARRAY[1, 4]::smallint[]",
  );
  await db.query(
    "INSERT INTO users(id, org_id, email, name, role) VALUES('comp-b-admin', 'comp-b', 'admin@compb.test', 'Admin B', 'administrator') ON CONFLICT DO NOTHING",
  );

  const actorCompB = {
    id: 'comp-b-admin',
    org_id: 'comp-b',
    role: 'administrator' as const,
    warehouse_id: 'comp-b:wh1',
    name: 'Admin B',
    email: 'admin@compb.test',
  };

  // Company B schedule suggestions return Mondays (1) and Thursdays (4) only
  const compBSuggestions = await suggestPreparationBatches(db, actorCompB, '2026-11-01', 4);
  assert.ok(compBSuggestions.length === 4);
  assert.ok(compBSuggestions.every((s) => s.weekday === 1 || s.weekday === 4));
  assert.ok(compBSuggestions.every((s) => s.emptyBatch === true && s.orderIds.length === 0));

  // Invariant check: Wednesday remains JadeSun preparation, never implicit delivery or automatic orders
  const jadeSunWeekdaysAfter = (await db.query("SELECT preparation_weekdays FROM company_configuration WHERE org_id='demo'")).rows[0].preparation_weekdays;
  assert.deepEqual(jadeSunWeekdaysAfter, [3]);

  // 3. Creating scheduled batch creates empty batch without any automatic customer orders (2026-11-02 is Monday = 1)
  const batchRes = await createScheduledEmptyBatch(db, actorCompB, { businessDate: '2026-11-02' });
  const batchDate = batchRes.business_date instanceof Date ? batchRes.business_date.toISOString().slice(0, 10) : String(batchRes.business_date).slice(0, 10);
  assert.equal(batchDate, '2026-11-02');
  const batchOrders = (await db.query("SELECT * FROM preparation_orders WHERE preparation_id=$1", [batchRes.id])).rows;
  assert.equal(batchOrders.length, 0); // Strictly empty batch!
});
