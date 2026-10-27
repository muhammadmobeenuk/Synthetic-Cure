import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as uuid } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openDatabase, migrate, type DB } from '../packages/database/index.js';
import { seed } from '../packages/database/seed.js';
import { createApp } from '../apps/api/app.js';
import { inject } from './inject.js';
import {
  createStockOwner,
  adjustInventory,
  reserveInventory,
  releaseInventory,
  moveInventory,
  getInventoryBalances,
  createUnitConversion,
  convertProductQuantity,
  createPurchaseOrder,
  receivePurchaseOrderLine,
  cancelPurchaseOrder,
  reportDiscrepancy,
  reviewDiscrepancy,
  createSupplierReturn,
  authorizeSupplierReturn,
  dispatchSupplierReturn,
  createPutawayTask,
  assignTask,
  completeTask,
  setReplenishmentPolicy,
  triggerReplenishment,
  createTransferOrder,
  dispatchTransferOrder,
  receiveTransferOrder,
  previewCsvImport,
  commitCsvImport,
  saveOnboardingStep,
  getWarehouseOnboarding,
  completeOnboardingReview,
} from '../packages/domain/index.js';

let db: DB;
let app: any;
let uploadsDir: string;
let adminHeaders: Record<string, string>;
let supervisorHeaders: Record<string, string>;
let operatorHeaders: Record<string, string>;

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

before(async () => {
  uploadsDir = await mkdtemp(path.join(os.tmpdir(), 'jadesun-p1-test-'));
  db = await openDatabase(null, ':memory:');
  await migrate(db);
  await seed(db);
  app = createApp(db, { uploads: uploadsDir, demo: true });

  adminHeaders = await httpSession(app, 'demo-admin');
  supervisorHeaders = adminHeaders;
  operatorHeaders = await httpSession(app, 'demo-operator');
});

after(async () => {
  if (db) await db.close();
  if (uploadsDir) await rm(uploadsDir, { recursive: true, force: true });
});

test('P1.1 Unified Quantity/Container Inventory: loose balances, coherent ledger, reservations do not create stock', async () => {
  // 1. Adjust loose stock in l1 for p1 (base unit: piece): +100 piece
  const adjustPayload = p({
    productId: 'p1',
    locationId: 'l1',
    quantityDelta: '100',
    unit: 'piece',
    state: 'on_hand' as const,
    reason: 'Initial loose bulk receiving for calendars',
  });

  const adjusted = await adjustInventory(db, adminActor, adjustPayload);
  assert.equal(adjusted.on_hand, '100.000000');
  assert.equal(adjusted.available, '100.000000');
  assert.equal(adjusted.reserved, '0.000000');
  assert.equal(adjusted.held, '0.000000');

  // Verify ledger entry created in db
  const ledgerRows = (
    await db.query(
      'SELECT * FROM inventory_ledger WHERE org_id=$1 AND product_id=$2 AND location_id=$3 ORDER BY created_at DESC LIMIT 1',
      [adminActor.org_id, 'p1', 'l1']
    )
  ).rows;
  assert.equal(ledgerRows[0].quantity_delta, '100.000000');
  assert.equal(ledgerRows[0].notes, adjustPayload.reason);

  // 2. Reserve 30 piece from available
  const reservePayload = p({
    productId: 'p1',
    locationId: 'l1',
    quantity: '30',
    unit: 'piece',
    reason: 'Reserve for pending order allocation',
  });
  const reserved = await reserveInventory(db, adminActor, reservePayload);
  assert.equal(reserved.on_hand, '100.000000'); // on_hand stays constant!
  assert.equal(reserved.reserved, '30.000000');
  assert.equal(reserved.available, '70.000000'); // available = on_hand - reserved = 70

  // 3. Reserving more than available must fail! (Reservations never create stock)
  await assert.rejects(
    reserveInventory(db, adminActor, p({
      productId: 'p1',
      locationId: 'l1',
      quantity: '80', // Only 70 available!
      unit: 'piece',
      reason: 'Over-reservation attempt',
    })),
    (err: any) => err.code === 'INSUFFICIENT_STOCK'
  );

  // 4. Release 10 piece back to available
  const releasePayload = p({
    productId: 'p1',
    locationId: 'l1',
    quantity: '10',
    unit: 'piece',
    reason: 'Release partial reservation',
  });
  const released = await releaseInventory(db, adminActor, releasePayload);
  assert.equal(released.on_hand, '100.000000');
  assert.equal(released.reserved, '20.000000');
  assert.equal(released.available, '80.000000');

  // 5. Move 25 piece from l1 to l2
  const movePayload = p({
    expectedVersion: Number(released.version),
    productId: 'p1',
    sourceLocationId: 'l1',
    destinationLocationId: 'l2',
    quantity: '25',
    unit: 'piece',
    reason: 'Transfer loose bulk stock to staging line',
  });
  const moved = await moveInventory(db, adminActor, released.id, movePayload);
  assert.equal(moved.source.on_hand, '75.000000');
  assert.equal(moved.source.available, '55.000000');
  assert.equal(moved.source.reserved, '20.000000');
  assert.equal(moved.destination.on_hand, '25.000000');
  assert.equal(moved.destination.available, '25.000000');

  // HTTP API Endpoint verification
  const httpAdjust = await inject(app, {
    method: 'POST',
    url: '/api/v1/inventory/adjust',
    headers: adminHeaders,
    body: p({
      productId: 'p1',
      locationId: 'l1',
      quantityDelta: '15',
      unit: 'piece',
      state: 'on_hand',
      reason: 'HTTP loose stock adjustment',
    }),
  });
  assert.equal(httpAdjust.status, 200);
  assert.equal(httpAdjust.body.on_hand, '90.000000');
});

test('P1.2 Stock Ownership: explicit 3PL owners and balance isolation', async () => {
  // Create two distinct stock owners
  const ownerA = await createStockOwner(db, adminActor, p({
    code: 'CLIENT-ALPHA-' + uuid().slice(0, 8),
    name: 'Alpha Logistics 3PL Client',
  }));
  const ownerB = await createStockOwner(db, adminActor, p({
    code: 'CLIENT-BETA-' + uuid().slice(0, 8),
    name: 'Beta Global Trading 3PL Client',
  }));

  assert.ok(ownerA.id);
  assert.ok(ownerB.id);

  // Adjust stock for Owner A at l1 (p1 base unit: piece)
  await adjustInventory(db, adminActor, p({
    productId: 'p1',
    locationId: 'l1',
    ownerId: ownerA.id,
    quantityDelta: '500',
    unit: 'piece',
    state: 'on_hand',
    reason: 'Inbound consignment for Alpha',
  }));

  // Verify Owner A has 500 at l1
  const balancesA = await getInventoryBalances(db, adminActor, {
    productId: 'p1',
    locationId: 'l1',
    ownerId: ownerA.id,
  });
  assert.equal(balancesA.length, 1);
  assert.equal(balancesA[0].on_hand, '500.000000');
  assert.equal(balancesA[0].owner_id, ownerA.id);

  // Verify Owner B has 0 at l1
  const balancesB = await getInventoryBalances(db, adminActor, {
    productId: 'p1',
    locationId: 'l1',
    ownerId: ownerB.id,
  });
  assert.equal(balancesB.length, 0);

  // HTTP Endpoint to list stock owners
  const listRes = await inject(app, {
    url: '/api/v1/inventory/owners',
    headers: adminHeaders,
  });
  assert.equal(listRes.status, 200);
  assert.ok(listRes.body.owners.some((o: any) => o.id === ownerA.id));
});

test('P1.3 Units, Pack Definitions & Variable Weight: verified conversions and catch weight', async () => {
  // 1. Create verified product unit conversion: 1 case = 24 piece
  const conv = await createUnitConversion(db, adminActor, 'p1', p({
    fromUnit: 'case',
    toUnit: 'piece',
    factor: '24',
    verified: true,
  }));
  assert.equal(conv.factor, '24.000000');
  assert.equal(conv.verified, true);

  // Forward conversion: 3 cases -> pieces
  const forward = await convertProductQuantity(
    db,
    adminActor.org_id,
    'p1',
    '3',
    'case',
    'piece',
  );
  assert.equal(forward.convertedQuantity, '72.000000');
  assert.equal(forward.factor, '24.000000');

  // Inverse conversion: 48 pieces -> cases
  const inverse = await convertProductQuantity(
    db,
    adminActor.org_id,
    'p1',
    '48',
    'piece',
    'case',
  );
  assert.equal(inverse.convertedQuantity, '2.000000');

  // Unknown conversion must fail and NEVER invent zero or guessed totals!
  await assert.rejects(
    convertProductQuantity(
      db,
      adminActor.org_id,
      'p1',
      '10',
      'piece',
      'barrel', // undefined conversion
    ),
    (err: any) => err.code === 'UNKNOWN_CONVERSION'
  );

  // 2. Variable weight and catch weight on contents
  // Create box with independent measured catch weight and package count
  const boxRes = await inject(app, {
    method: 'POST',
    url: '/api/v1/receipts',
    headers: adminHeaders,
    body: p({
      customerId: null,
      locationId: 'l1',
      sourceLabel: 'Variable catch weight test box',
      contents: [
        {
          productId: 'p1',
          quantity: '1',
          unit: 'piece',
          verified: true,
          catchWeight: '23.450', // independent measured weight
          packageCount: 24,       // independent package count
        },
      ],
    }),
  });
  assert.equal(boxRes.status, 200, JSON.stringify(boxRes.body));
  assert.equal(boxRes.body.contents[0].catch_weight, '23.450000');
  assert.equal(boxRes.body.contents[0].package_count, 24);
});

test('P1.4 Multi-line Purchase Orders: multi-line PO, partial arrival, remaining balance and cancellation', async () => {
  // Create supplier
  const supplierRes = await inject(app, {
    method: 'POST',
    url: '/api/v1/suppliers',
    headers: adminHeaders,
    body: p({
      code: 'SUP-MULTILINE-' + uuid().slice(0, 8),
      name: 'Global Fresh Inbound Co.',
    }),
  });
  assert.equal(supplierRes.status, 200);
  const supplierId = supplierRes.body.id;

  // Create multi-line PO with 2 products: p1 (piece), p2 (kg)
  const poRes = await inject(app, {
    method: 'POST',
    url: '/api/v1/purchase-orders',
    headers: adminHeaders,
    body: p({
      poNumber: 'PO-' + uuid().slice(0, 8),
      supplierId,
      expectedDate: '2026-11-15',
      supplierReference: 'SUPP-INV-998822',
      lines: [
        { productId: 'p1', expectedQuantity: '100', unit: 'piece' },
        { productId: 'p2', expectedQuantity: '50', unit: 'kg' },
      ],
    }),
  });
  assert.equal(poRes.status, 200, JSON.stringify(poRes.body));
  const po = poRes.body;
  assert.equal(po.status, 'open');
  assert.equal(po.lines.length, 2);
  assert.equal(po.lines[0].remaining_balance, '100.000000');
  assert.equal(po.lines[1].remaining_balance, '50.000000');

  // Receive partial quantity on line 1: receive 40 of 100
  const receiveRes = await inject(app, {
    method: 'POST',
    url: `/api/v1/purchase-orders/${po.id}/receive`,
    headers: adminHeaders,
    body: p({
      expectedVersion: po.version,
      lineId: po.lines[0].id,
      locationId: 'l1',
      quantity: '40',
      unit: 'piece',
      condition: 'good',
    }),
  });
  assert.equal(receiveRes.status, 200, JSON.stringify(receiveRes.body));
  const updatedPo = receiveRes.body.purchaseOrder;
  assert.equal(updatedPo.status, 'partially_received');
  const line0 = updatedPo.lines.find((l: any) => l.id === po.lines[0].id);
  assert.equal(line0.received_quantity, '40.000000');
  assert.equal(line0.remaining_balance, '60.000000');

  // Cancel remaining balance on PO
  const cancelRes = await inject(app, {
    method: 'POST',
    url: `/api/v1/purchase-orders/${po.id}/cancel`,
    headers: adminHeaders,
    body: p({
      expectedVersion: updatedPo.version,
      reason: 'Supplier out of stock for remainder of shipment',
    }),
  });
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelRes.body.status, 'cancelled');
});

test('P1.5 Unexpected, Over, Short and Damaged Delivery: discrepancy reporting & authorized disposition', async () => {
  // 1. Report discrepancy for damaged delivery
  const disc = await reportDiscrepancy(db, adminActor, p({
    kind: 'damaged' as const,
    productId: 'p1',
    reportedQuantity: '12',
    unit: 'piece',
    evidence: 'Crushed cartons on pallet bottom layer during unloader inspection',
  }));
  assert.equal(disc.kind, 'damaged');
  assert.equal(disc.status, 'pending');
  assert.equal(disc.reported_quantity, '12.000000');

  // 2. Review and approve discrepancy with disposition 'accept_hold'
  const reviewed = await reviewDiscrepancy(db, supervisorActor, disc.id, p({
    expectedVersion: disc.version,
    approved: true,
    disposition: 'accept_hold' as const,
    notes: 'Accepted on hold pending manufacturer inspection report',
  }));
  assert.equal(reviewed.status, 'approved');
  assert.equal(reviewed.disposition, 'accept_hold');
  assert.equal(reviewed.reviewed_by, supervisorActor.id);
  assert.ok(reviewed.reviewed_at);

  // HTTP Endpoint verify
  const httpGet = await inject(app, {
    url: `/api/v1/discrepancies/${disc.id}`,
    headers: adminHeaders,
  });
  assert.equal(httpGet.status, 200);
  assert.equal(httpGet.body.disposition, 'accept_hold');
});

test('P1.6 Supplier Return: return held goods, outbound custody, no implicit release to available', async () => {
  // 1. Adjust held stock at l1: 15 piece held for p1
  await adjustInventory(db, adminActor, p({
    productId: 'p1',
    locationId: 'l1',
    quantityDelta: '15',
    unit: 'piece',
    state: 'held' as const,
    reason: 'Damaged shipment placed on quarantine hold',
  }));

  // Create supplier for return
  const supp = await db.query(
    "INSERT INTO suppliers(id, org_id, code, name) VALUES($1, 'demo', $2, 'Return Supplier') RETURNING id",
    [uuid(), 'SUPP-RET-' + uuid().slice(0, 6)]
  );
  const supplierId = supp.rows[0].id;

  // 2. Create supplier return order targeting the held goods
  const ret = await createSupplierReturn(db, adminActor, p({
    supplierId,
    productId: 'p1',
    quantity: '15',
    unit: 'piece',
    reason: 'Product failed inbound QA criteria',
  }));
  assert.equal(ret.status, 'held');
  assert.equal(ret.quantity, '15.000000');

  // 3. Authorize supplier return by supervisor
  const authorized = await authorizeSupplierReturn(db, supervisorActor, ret.id, p({
    expectedVersion: ret.version,
    notes: 'Supplier approved RMA # RMA-44919',
  }));
  assert.equal(authorized.status, 'authorized');
  assert.equal(authorized.authorized_by, supervisorActor.id);

  // 4. Dispatch supplier return to outbound custody
  const dispatched = await dispatchSupplierReturn(db, adminActor, ret.id, p({
    expectedVersion: authorized.version,
    outboundTracking: 'TRK-99008811',
    notes: 'Handed off to DHL driver',
  }));
  assert.equal(dispatched.status, 'dispatched');
  assert.equal(dispatched.outbound_tracking, 'TRK-99008811');

  // 5. Invariant check: held stock was decremented and NEVER became available!
  const bal = await getInventoryBalances(db, adminActor, {
    productId: 'p1',
    locationId: 'l1',
  });
  const l1Bal = bal.find((b) => b.location_id === 'l1');
  assert.equal(l1Bal?.held, '0.000000');
});

test('P1.7 Putaway Tasks: scan/ID confirmation, source and destination, placement', async () => {
  // Create putaway task from receiving (l1) to high-bay rack (l2)
  const task = await createPutawayTask(db, adminActor, p({
    productId: 'p1',
    sourceLocationId: 'l1',
    destinationLocationId: 'l2',
    quantity: '10',
    unit: 'piece',
    priority: 2,
  }));
  assert.equal(task.status, 'pending');
  assert.equal(task.kind, 'putaway');

  // Assign task to operator
  const assigned = await assignTask(db, supervisorActor, task.id, p({
    expectedVersion: task.version,
    userId: operatorActor.id,
  }));
  assert.equal(assigned.status, 'assigned');
  assert.equal(assigned.assigned_user_id, operatorActor.id);

  // Complete task with destination scan confirmation (location l2 code: '0002')
  const destLoc = (await db.query("SELECT code FROM locations WHERE id='l2'")).rows[0];
  const completed = await completeTask(db, operatorActor, task.id, p({
    expectedVersion: assigned.version,
    scanConfirmation: destLoc.code,
  }));
  assert.equal(completed.status, 'completed');
  assert.ok(completed.completed_at);

  // Scan mismatch must be rejected
  const task2 = await createPutawayTask(db, adminActor, p({
    productId: 'p1',
    sourceLocationId: 'l1',
    destinationLocationId: 'l2',
    quantity: '5',
    unit: 'piece',
  }));
  await assert.rejects(
    completeTask(db, adminActor, task2.id, p({
      expectedVersion: task2.version,
      scanConfirmation: 'WRONG-BARCODE-999',
    })),
    (err: any) => err.code === 'SCAN_MISMATCH'
  );
});

test('P1.8 Replenishment: minimum/target thresholds, duplicate-open-task prevention, reserve-to-pick', async () => {
  // Pick location: l1. Reserve location: l2. Product: p2 (base unit: kg).
  // First, set replenishment policy on l1: min 20, target 50
  const policy = await setReplenishmentPolicy(db, adminActor, p({
    locationId: 'l1',
    productId: 'p2',
    minQuantity: '20',
    targetQuantity: '50',
    unit: 'kg',
  }));
  assert.equal(policy.min_quantity, '20.000000');
  assert.equal(policy.target_quantity, '50.000000');

  // Put 100 kg in reserve location l2
  await adjustInventory(db, adminActor, p({
    productId: 'p2',
    locationId: 'l2',
    quantityDelta: '100',
    unit: 'kg',
    state: 'on_hand',
    reason: 'Stocking reserve location l2',
  }));

  // Ensure pick location l1 has 5 kg (below min 20)
  await adjustInventory(db, adminActor, p({
    productId: 'p2',
    locationId: 'l1',
    quantityDelta: '5',
    unit: 'kg',
    state: 'on_hand',
    reason: 'Low stock in pick location',
  }));

  // Trigger replenishment
  const result = await triggerReplenishment(db, adminActor, p({
    locationId: 'l1',
    productId: 'p2',
  }));
  assert.equal(result.createdCount, 1);
  assert.equal(result.tasks.length, 1);
  const repTask = result.tasks[0];
  // Deficit to target: 50 - 5 = 45 kg
  assert.equal(repTask.quantity, '45.000000');
  assert.equal(repTask.source_location_id, 'l2');
  assert.equal(repTask.destination_location_id, 'l1');

  // Triggering again while task is open must NOT create duplicate open task!
  const duplicateCheck = await triggerReplenishment(db, adminActor, p({
    locationId: 'l1',
    productId: 'p2',
  }));
  assert.equal(duplicateCheck.createdCount, 0);
  assert.equal(duplicateCheck.tasks.length, 0);
});

test('P1.9 Inter-Warehouse Transfers: explicit order, dispatch creates transit, destination receipt removes transit', async () => {
  // Ensure second warehouse exists
  await db.query(
    "INSERT INTO warehouses(id, org_id, code, name, address) VALUES('wh-second', 'demo', 'WH-2', 'Second Distribution Center', 'North Depot') ON CONFLICT DO NOTHING"
  );
  // Ensure location in second warehouse
  await db.query(
    "INSERT INTO locations(id, org_id, warehouse_id, code, name, kind) VALUES('loc-wh2-recv', 'demo', 'wh-second', 'WH2-RCV', 'Receiving Dock', 'floor') ON CONFLICT DO NOTHING"
  );

  // Put 80 piece stock in source warehouse (demo:legacy, l1)
  await adjustInventory(db, adminActor, p({
    productId: 'p1',
    locationId: 'l1',
    quantityDelta: '80',
    unit: 'piece',
    state: 'on_hand',
    reason: 'Preparation for inter-warehouse transfer',
  }));

  // 1. Create Transfer Order from demo:legacy to wh-second
  const transfer = await createTransferOrder(db, adminActor, p({
    orderNumber: 'TRF-' + uuid().slice(0, 8),
    destinationWarehouseId: 'wh-second',
    lines: [
      {
        productId: 'p1',
        requestedQuantity: '30',
        unit: 'piece',
      },
    ],
  }));
  assert.equal(transfer.status, 'requested');
  assert.equal(transfer.destination_warehouse_id, 'wh-second');

  // 2. Dispatch Transfer from source
  const dispatched = await dispatchTransferOrder(db, adminActor, transfer.id, p({
    expectedVersion: transfer.version,
    lineDispatches: [
      {
        lineId: transfer.lines[0].id,
        dispatchedQuantity: '30',
        sourceLocationId: 'l1',
      },
    ],
    reason: 'Loaded onto internal inter-site shuttle',
  }));
  assert.equal(dispatched.status, 'dispatched');

  // Verify in_transit inventory exists
  const sourceBals = await getInventoryBalances(db, adminActor, {
    productId: 'p1',
    locationId: 'l1',
  });
  const inTransitBal = sourceBals.find((b) => Number(b.in_transit) > 0);
  assert.ok(inTransitBal, 'Must find in-transit inventory balance');
  assert.equal(inTransitBal.in_transit, '30.000000');

  // 3. Receive at Destination Warehouse
  const destinationActor = {
    ...adminActor,
    warehouse_id: 'wh-second',
  };
  const received = await receiveTransferOrder(db, destinationActor, transfer.id, p({
    expectedVersion: dispatched.version,
    lineReceipts: [
      {
        lineId: dispatched.lines[0].id,
        locationId: 'loc-wh2-recv',
        receivedQuantity: '28', // partial/short receipt
        damagedQuantity: '0',
      },
    ],
    reason: 'Unloaded at Second Distribution Center dock',
  }));
  assert.equal(received.status, 'partially_received');

  // Verify: in_transit is decremented (30 - 28 = 2 remaining), destination stock is created
  const postSourceBals = await getInventoryBalances(db, adminActor, {
    productId: 'p1',
    locationId: 'l1',
  });
  const postInTransit = postSourceBals.find((b) => Number(b.in_transit) > 0);
  assert.equal(postInTransit?.in_transit, '2.000000');

  const destBals = await getInventoryBalances(db, destinationActor, {
    productId: 'p1',
    locationId: 'loc-wh2-recv',
  });
  assert.equal(destBals[0].available, '28.000000');
  assert.equal(destBals[0].on_hand, '28.000000');
});

test('P1.10 Multi-Entity CSV Imports & Opening Stock Reconciliation', async () => {
  // 1. Preview Customers CSV import
  const customerCsv = `code,name\nCUST-IMPORT-1,Imported Customer One\nCUST-IMPORT-2,Imported Customer Two`;
  const preview = await previewCsvImport(db, adminActor, p({
    entityType: 'customers' as const,
    filename: 'customers-2026.csv',
    csv: customerCsv,
    mapping: { code: 0, name: 1 },
    reason: 'Importing customer records batch',
  }));
  assert.equal(preview.status, 'preview');
  assert.equal(preview.rowCount, 2);
  assert.equal(preview.errorCount, 0);

  // Commit Customers CSV import
  const committed = await commitCsvImport(db, adminActor, preview.id, p({
    expectedVersion: preview.version,
    reason: 'Commit customer records batch',
  }));
  assert.equal(committed.status, 'committed');

  // Verify customers were created in database
  const custCheck = await db.query(
    "SELECT count(*)::int n FROM customers WHERE code IN ('CUST-IMPORT-1', 'CUST-IMPORT-2')"
  );
  assert.equal(custCheck.rows[0].n, 2);

  // 2. Opening Stock import with cut-over date & reconciliation notes
  const openingStockCsv = `sku,location_code,quantity,unit\nPRD-001,RCV-01,50,piece`;
  const openingPreview = await previewCsvImport(db, adminActor, p({
    entityType: 'opening_stock' as const,
    filename: 'cutover-stock-2026.csv',
    csv: openingStockCsv,
    mapping: { sku: 0, location_code: 1, quantity: 2, unit: 3 },
    cutOverDate: '2026-10-25',
    reconciliationNotes: 'Audited physical inventory count by external auditor KPMG',
    reason: 'Cut-over opening stock reconciliation',
  }));
  assert.equal(openingPreview.rowCount, 1);
  assert.equal(openingPreview.errorCount, 0);

  const openingCommitted = await commitCsvImport(db, adminActor, openingPreview.id, p({
    expectedVersion: openingPreview.version,
    reason: 'Commit reconciled opening stock',
  }));
  assert.equal(openingCommitted.status, 'committed');

  // Verify opening stock reconciled event was logged
  const eventCheck = await db.query(
    "SELECT count(*)::int n FROM inventory_events WHERE kind = 'opening_stock.reconciled'"
  );
  assert.ok(eventCheck.rows[0].n >= 1);
});

test('P1.11 Guided Warehouse Onboarding & Policy Snapshots', async () => {
  // 1. Save profile step
  const step1 = await saveOnboardingStep(db, adminActor, p({
    step: 'profile' as const,
    stepData: {
      profileType: 'pharma_ambient',
      targetThroughputDaily: 2500,
      temperatureControlled: true,
    },
    markCompleted: true,
    reason: 'Configuring warehouse profile parameters',
  }));
  assert.equal(step1.step, 'staff');
  assert.ok(step1.completed_steps.includes('profile'));

  // 2. Save staff step
  const step2 = await saveOnboardingStep(db, adminActor, p({
    step: 'staff' as const,
    stepData: {
      initialOperatorCount: 8,
      supervisorAssigned: true,
    },
    markCompleted: true,
    reason: 'Configuring warehouse staff allocation',
  }));
  assert.ok(step2.completed_steps.includes('staff'));

  // 3. Query onboarding state
  const state = await getWarehouseOnboarding(db, adminActor);
  assert.ok(state.completed_steps.includes('profile'));
  assert.ok(state.completed_steps.includes('staff'));

  // 4. Warehouse readiness evaluation
  assert.ok(state.readiness);
  assert.ok(typeof state.readiness.locationsCount === 'number');
  assert.ok(typeof state.readiness.productsCount === 'number');

  // 5. Complete review and verify policy snapshot was preserved immutably
  await completeOnboardingReview(db, adminActor, p({
    policyNotes: 'Production warehouse policy review notes and readiness signoff',
    reason: 'Completing warehouse onboarding milestone',
  }));

  const policySnapshots = await db.query(
    "SELECT count(*)::int n FROM policy_snapshots WHERE org_id = 'demo'"
  );
  assert.ok(policySnapshots.rows[0].n >= 1);
});
