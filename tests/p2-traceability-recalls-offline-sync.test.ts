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
  createQualityHold,
  releaseQualityHold,
  listQualityHolds,
  initiateRecall,
  closeRecall,
  getRecallReport,
  exportRecallCsv,
  backwardTrace,
  forwardTrace,
  registerItemSerial,
  queueOfflineOperation,
  getOfflineOutbox,
  resolveOfflineConflict,
  syncOfflineOutboxBatch,
  escapeCsvCell,
} from '../packages/domain/index.js';

let db: DB;
let app: any;
let uploadsDir: string;
let adminHeaders: Record<string, string>;
let supervisorHeaders: Record<string, string>;
let operatorHeaders: Record<string, string>;
let driverHeaders: Record<string, string>;
let secondCompanyHeaders: Record<string, string>;

function p<T extends object>(b: T): T & { clientOperationId: string } {
  return { ...b, clientOperationId: uuid() };
}

async function httpSession(targetApp: any, userId = 'demo-admin', orgId = 'demo', warehouseId = 'demo:legacy') {
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
    'x-company-context': orgId,
    'x-warehouse-context': warehouseId,
  };
}


const adminActor = {
  id: 'demo-admin',
  org_id: 'demo',
  role: 'admin' as const,
  warehouse_id: 'demo:legacy',
  name: 'Demo Admin',
  email: 'admin@demo.test',
};

const supervisorActor = {
  id: 'demo-admin',
  org_id: 'demo',
  role: 'supervisor' as const,
  warehouse_id: 'demo:legacy',
  name: 'Demo Supervisor',
  email: 'supervisor@demo.test',
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
  uploadsDir = await mkdtemp(path.join(os.tmpdir(), 'jadesun-p2-traceability-'));
  db = await openDatabase(null, ':memory:');
  await migrate(db);
  await seed(db);
  app = createApp(db, { uploads: uploadsDir, demo: true });

  adminHeaders = await httpSession(app, 'demo-admin');
  supervisorHeaders = adminHeaders;
  operatorHeaders = await httpSession(app, 'demo-operator');
  driverHeaders = await httpSession(app, 'demo-driver');

  // Seed second company for cross-tenant boundary tests
  const bcrypt = (await import('bcryptjs')).default;
  const c2Password = 'comp2-secret-pass-123';
  const c2Hash = await bcrypt.hash(c2Password, 4);
  await db.query("INSERT INTO organizations(id, name, demo) VALUES('comp2', 'Second Company Ltd', true) ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO users(id, org_id, email, name, role, password_hash, active) VALUES('c2-admin', 'comp2', 'admin@comp2.test', 'Comp2 Admin', 'administrator', $1, true) ON CONFLICT DO NOTHING", [c2Hash]);
  await db.query("INSERT INTO company_memberships(user_id, org_id, role, active) VALUES('c2-admin', 'comp2', 'administrator', true) ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO warehouses(id, org_id, code, name, active) VALUES('comp2:w1', 'comp2', 'W1', 'Warehouse 1', true) ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO warehouse_grants(user_id, org_id, warehouse_id, active) VALUES('c2-admin', 'comp2', 'comp2:w1', true) ON CONFLICT DO NOTHING");

  const boot = await inject(app, { url: '/api/v1/session' });
  const logged = await inject(app, {
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { Cookie: boot.headers['set-cookie'][0].split(';')[0], 'X-CSRF-Token': boot.body.csrf },
    body: { email: 'admin@comp2.test', password: c2Password },
  });
  assert.equal(logged.status, 200);
  const c2Cookie = logged.headers['set-cookie'][0].split(';')[0];
  const c2Session = await inject(app, { url: '/api/v1/session', headers: { Cookie: c2Cookie } });

  const switched = await inject(app, {
    method: 'POST',
    url: '/api/v1/auth/context',
    headers: { Cookie: c2Cookie, 'X-CSRF-Token': c2Session.body.csrf },
    body: { companyId: 'comp2', warehouseId: 'comp2:w1' },
  });
  assert.equal(switched.status, 200);
  const activeCookie = switched.headers['set-cookie'][0].split(';')[0];
  const activeSession = await inject(app, { url: '/api/v1/session', headers: { Cookie: activeCookie } });

  secondCompanyHeaders = {
    Cookie: activeCookie,
    'X-CSRF-Token': activeSession.body.csrf,
    'x-company-context': 'comp2',
    'x-warehouse-context': 'comp2:w1',
  };
});


after(async () => {
  await rm(uploadsDir, { recursive: true, force: true }).catch(() => {});
});

// =========================================================================
// 1. Serial Number Tracking & Registration
// =========================================================================
test('P2.1 Serial Tracking: register serials, enforce uniqueness, forward trace by serial', async () => {
  const serialNo = `SN-2026-${Date.now()}`;

  // 1. Register serial number via API
  const regRes = await inject(app, {
    method: 'POST',
    url: '/api/v1/serials',
    headers: operatorHeaders,
    body: p({
      productId: 'p1',
      serialNumber: serialNo,
      locationId: 'l1',
    }),
  });
  assert.equal(regRes.status, 200);
  assert.equal(regRes.body.serial_number, serialNo);
  assert.equal(regRes.body.status, 'received');

  // 2. Duplicate serial on same product rejected with 409
  const dupRes = await inject(app, {
    method: 'POST',
    url: '/api/v1/serials',
    headers: operatorHeaders,
    body: p({
      productId: 'p1',
      serialNumber: serialNo,
    }),
  });
  assert.equal(dupRes.status, 409);

  // 3. Forward trace finds serial
  const traceRes = await inject(app, {
    method: 'GET',
    url: `/api/v1/traceability/forward?serialNumber=${encodeURIComponent(serialNo)}`,
    headers: operatorHeaders,
  });
  assert.equal(traceRes.status, 200);
  assert.ok(traceRes.body.serial);
  assert.equal(traceRes.body.serial.serial_number, serialNo);
});

// =========================================================================
// 2. Quality Quarantine Holds & Allocation/Picking Protection
// =========================================================================
test('P2.2 Quality Quarantine Holds: place hold, block allocation, block picking, concurrency release', async () => {
  // 1. Create a fresh test product and stored box
  const prodId = 'prod-hold-test';
  await db.query(
    "INSERT INTO products(id, org_id, sku, name, profile, unit, version) VALUES($1, 'demo', 'HOLD-01', 'Quarantine Item', 'general', 'piece', 1) ON CONFLICT DO NOTHING",
    [prodId],
  );
  const boxId = uuid();
  await db.query(
    "INSERT INTO boxes(id, org_id, code, location_id, status, condition, version) VALUES($1, 'demo', $2, 'l1', 'confirmed', 'good', 1)",
    [boxId, `BOX-HOLD-${Date.now()}`],
  );
  await db.query(
    "INSERT INTO contents(id, org_id, box_id, product_id, quantity, unit, verified) VALUES($1, 'demo', $2, $3, 10, 'piece', true)",
    [uuid(), boxId, prodId],
  );

  // 2. Create customer order requesting this product
  const orderId = uuid();
  const orderLineId = uuid();
  await db.query(
    "INSERT INTO orders(id, org_id, code, customer_id, destination_id, status, version) VALUES($1, 'demo', $2, 'c1', 'd1', 'open', 1)",
    [orderId, `ORD-HOLD-${Date.now()}`],
  );
  await db.query(
    "INSERT INTO order_lines(id, org_id, order_id, product_id, quantity, unit) VALUES($1, 'demo', $2, $3, 10, 'piece')",
    [orderLineId, orderId, prodId],
  );

  // 3. Place quality quarantine hold on the product via API
  const holdRes = await inject(app, {
    method: 'POST',
    url: '/api/v1/quality-holds',
    headers: supervisorHeaders,
    body: p({
      scope: 'product',
      targetId: prodId,
      reason: 'Suspected contamination in packaging',
      severity: 'critical',
    }),
  });
  assert.equal(holdRes.status, 200);
  assert.equal(holdRes.body.status, 'active');
  const holdId = holdRes.body.id;

  // 4. Invariant: Allocation MUST be rejected while under active quality hold!
  const allocRes = await inject(app, {
    method: 'POST',
    url: `/api/v1/orders/${orderId}/allocate`,
    headers: supervisorHeaders,
    body: p({
      expectedVersion: 1,
      boxId: boxId,
      orderLineId: orderLineId,
      quantity: '10',
    }),
  });
  assert.equal(allocRes.status, 422);
  assert.match(allocRes.body.error.message, /active quality hold/i);

  // 5. Invariant: Picking verification MUST also be rejected while under active quality hold!
  await assert.rejects(
    () =>
      inject(app, {
        method: 'POST',
        url: '/api/v1/picking/verify',
        headers: operatorHeaders,
        body: p({
          orderId,
          orderLineId,
          sourceLocationId: 'l1',
          productId: prodId,
          quantityPicked: '10',
        }),
      }).then((r) => {
        if (r.status >= 400) throw new Error(r.body.error.message);
        return r;
      }),
    /active quality hold/i,
  );

  // 6. Release hold with stale expectedVersion returns 409
  const staleRelease = await inject(app, {
    method: 'POST',
    url: `/api/v1/quality-holds/${holdId}/release`,
    headers: supervisorHeaders,
    body: p({
      expectedVersion: 999, // Stale!
      releaseReason: 'QA lab cleared sample',
      disposition: 'release_as_is',
    }),
  });
  assert.equal(staleRelease.status, 409);

  // 7. Successful release with correct expectedVersion
  const releaseRes = await inject(app, {
    method: 'POST',
    url: `/api/v1/quality-holds/${holdId}/release`,
    headers: supervisorHeaders,
    body: p({
      expectedVersion: holdRes.body.version,
      releaseReason: 'QA lab cleared sample and certified safe',
      disposition: 'release_as_is',
    }),
  });
  assert.equal(releaseRes.status, 200);
  assert.equal(releaseRes.body.status, 'released');
  assert.equal(releaseRes.body.release_reason, 'QA lab cleared sample and certified safe');

  // 8. Now allocation succeeds after release!
  const successAlloc = await inject(app, {
    method: 'POST',
    url: `/api/v1/orders/${orderId}/allocate`,
    headers: supervisorHeaders,
    body: p({
      expectedVersion: 1,
      boxId: boxId,
      orderLineId: orderLineId,
      quantity: '10',
    }),
  });
  assert.equal(successAlloc.status, 200);
});

// =========================================================================
// 3. Authoritative Recalls, Impact Analysis & Formula Neutralization
// =========================================================================
test('P2.3 Recalls: initiate recall, auto quarantine on-hand, impact dossier, formula neutralization CSV', async () => {
  const recallCode = `REC-${Date.now()}`;
  const prodId = 'prod-recall-test';
  await db.query(
    "INSERT INTO products(id, org_id, sku, name, profile, unit, version) VALUES($1, 'demo', 'REC-SKU', '=CMD() Dangerous Formula Injection Product', 'general', 'box', 1) ON CONFLICT DO NOTHING",
    [prodId],
  );

  // Seed on-hand boxes
  const box1 = uuid();
  const box2 = uuid();
  await db.query(
    "INSERT INTO boxes(id, org_id, code, location_id, status, condition, version) VALUES($1, 'demo', 'BOX-RC-1', 'l1', 'stored', 'good', 1)",
    [box1],
  );
  await db.query(
    "INSERT INTO boxes(id, org_id, code, location_id, status, condition, version) VALUES($1, 'demo', 'BOX-RC-2', 'l2', 'stored', 'good', 1)",
    [box2],
  );
  await db.query("INSERT INTO contents(id, org_id, box_id, product_id, quantity, unit, verified) VALUES($1, 'demo', $2, $3, 5, 'box', true)", [uuid(), box1, prodId]);
  await db.query("INSERT INTO contents(id, org_id, box_id, product_id, quantity, unit, verified) VALUES($1, 'demo', $2, $3, 10, 'box', true)", [uuid(), box2, prodId]);

  // Seed outbound delivered shipment
  const orderId = uuid();
  const shipId = uuid();
  const tripId = uuid();
  const stopId = uuid();
  await db.query("INSERT INTO trips(id, org_id, code, business_date, driver_id, status, version) VALUES($1, 'demo', 'TRIP-RC', '2026-10-28', 'demo-driver', 'planned', 1)", [tripId]);
  await db.query("INSERT INTO stops(id, org_id, trip_id, destination_id, position) VALUES($1, 'demo', $2, 'd1', 1)", [stopId, tripId]);
  await db.query("INSERT INTO orders(id, org_id, code, customer_id, destination_id, status, version) VALUES($1, 'demo', 'ORD-RC-1', 'c1', 'd1', 'open', 1)", [orderId]);
  await db.query("INSERT INTO shipments(id, org_id, order_id, destination_id, trip_id, stop_id, status, version) VALUES($1, 'demo', $2, 'd1', $3, $4, 'delivered', 1)", [shipId, orderId, tripId, stopId]);
  await db.query(
    "INSERT INTO shipment_lines(id, org_id, shipment_id, box_id, product_id, quantity, unit, loaded, delivered) VALUES($1, 'demo', $2, $3, $4, 5, 'box', true, 5)",
    [uuid(), shipId, box1, prodId],
  );

  // 1. Initiate recall via API
  const initRes = await inject(app, {
    method: 'POST',
    url: '/api/v1/recalls',
    headers: supervisorHeaders,
    body: p({
      code: recallCode,
      title: '+SUM(A1:B2) Mandatory Safety Recall',
      productId: prodId,
      reason: '@DANGEROUS Allergen Mislabeling Detected',
      severity: 'class_1',
    }),
  });
  assert.equal(initRes.status, 200);
  assert.equal(initRes.body.status, 'active');
  assert.equal(initRes.body.affected_on_hand_boxes, 2);
  const recallId = initRes.body.id;

  // Verify on-hand boxes automatically transitioned to condition = 'hold'
  const b1Condition = (await db.query("SELECT condition FROM boxes WHERE id = $1", [box1])).rows[0].condition;
  const b2Condition = (await db.query("SELECT condition FROM boxes WHERE id = $1", [box2])).rows[0].condition;
  assert.equal(b1Condition, 'hold');
  assert.equal(b2Condition, 'hold');

  // 2. Fetch full recall report
  const reportRes = await inject(app, {
    method: 'GET',
    url: `/api/v1/recalls/${recallId}`,
    headers: supervisorHeaders,
  });
  assert.equal(reportRes.status, 200);
  assert.equal(reportRes.body.totals.onHandBoxesCount, 2);
  assert.equal(reportRes.body.totals.totalOnHandQuantity, '15');
  assert.equal(reportRes.body.totals.affectedCustomersCount, 1);
  assert.equal(reportRes.body.outboundDistribution[0].customer_id, 'c1');
  assert.equal(reportRes.body.outboundDistribution[0].customer_code, '0001');

  // 3. Export CSV with Formula Injection Neutralization
  const csvRes = await inject(app, {
    method: 'GET',
    url: `/api/v1/recalls/${recallId}/export`,
    headers: supervisorHeaders,
  });
  assert.equal(csvRes.status, 200);
  assert.equal(csvRes.headers['content-type'], 'text/csv; charset=utf-8');

  // Formula characters '=', '+', '-', '@' must be neutralized with leading apostrophe "'"
  const csvText = csvRes.raw.toString('utf-8');
  assert.ok(csvText.includes("'+SUM(A1:B2) Mandatory Safety Recall"));
  assert.ok(csvText.includes("'@DANGEROUS Allergen Mislabeling Detected"));
  assert.ok(csvText.includes("'=CMD() Dangerous Formula Injection Product"));

  // 4. Close recall with reason
  const closeRes = await inject(app, {
    method: 'POST',
    url: `/api/v1/recalls/${recallId}/close`,
    headers: supervisorHeaders,
    body: p({
      expectedVersion: initRes.body.version,
      closureNotes: 'All customers notified, stock safely disposed',
    }),
  });
  assert.equal(closeRes.status, 200);
  assert.equal(closeRes.body.status, 'completed');
  assert.equal(closeRes.body.closure_notes, 'All customers notified, stock safely disposed');
});

// =========================================================================
// 4. Forward and Backward Traceability Engine
// =========================================================================
test('P2.4 Traceability Engine: backward trace from customer box to PO, forward trace from lot to shipments', async () => {
  // 1. Setup supplier, PO, and expected receipt
  const supId = uuid();
  const poId = uuid();
  const lotId = uuid();
  const prodId = 'p1';
  const boxId = uuid();
  await db.query("INSERT INTO suppliers(id, org_id, code, name) VALUES($1, 'demo', 'SUP-TR', 'Trace Supplier') ON CONFLICT DO NOTHING", [supId]);
  await db.query("INSERT INTO lots(id, org_id, product_id, reference, manufactured_on, expires_on) VALUES($1, 'demo', $2, 'LOT-TR-001', '2026-01-01', '2027-01-01')", [lotId, prodId]);
  await db.query("INSERT INTO boxes(id, org_id, code, location_id, status, condition, version) VALUES($1, 'demo', 'BOX-TR-001', 'l1', 'stored', 'good', 1)", [boxId]);
  await db.query("INSERT INTO contents(id, org_id, box_id, product_id, lot_id, quantity, unit, verified) VALUES($1, 'demo', $2, $3, $4, 25, 'piece', true)", [uuid(), boxId, prodId, lotId]);

  // Backward trace
  const bTraceRes = await inject(app, {
    method: 'GET',
    url: `/api/v1/traceability/backward?boxId=${boxId}`,
    headers: operatorHeaders,
  });
  assert.equal(bTraceRes.status, 200);
  assert.equal(bTraceRes.body.box.code, 'BOX-TR-001');
  assert.equal(bTraceRes.body.contents[0].lot_reference, 'LOT-TR-001');
  assert.ok(String(bTraceRes.body.contents[0].manufactured_on).startsWith('2026-01-01'));

  // Forward trace
  const fTraceRes = await inject(app, {
    method: 'GET',
    url: `/api/v1/traceability/forward?lotId=${lotId}`,
    headers: operatorHeaders,
  });
  assert.equal(fTraceRes.status, 200);
  assert.ok(fTraceRes.body.onHandInventory.length > 0);
  assert.equal(fTraceRes.body.onHandInventory[0].box_code, 'BOX-TR-001');
});

// =========================================================================
// 5. Scoped Offline Sync Outbox & Dependency Ordering
// =========================================================================
test('P2.5 Scoped Offline Sync: queue operations, file-before-command dependency, visible 409 conflict, bounded retries', async () => {
  const opId1 = uuid();
  const fileUploadId = uuid();

  // 1. Queue an operation that depends on a document file upload
  const queueRes = await inject(app, {
    method: 'POST',
    url: '/api/v1/sync/queue',
    headers: operatorHeaders,
    body: {
      operationId: opId1,
      command: 'boxes.receive',
      endpoint: '/api/v1/boxes',
      payload: { code: 'OFFLINE-BOX-1', quantity: 10 },
      fileUploadId: fileUploadId,
    },
  });
  assert.equal(queueRes.status, 200);
  assert.equal(queueRes.body.status, 'queued');

  // 2. Process batch: file is NOT yet in documents table -> stays in 'uploading_file'
  const results1 = await syncOfflineOutboxBatch(db, operatorActor, async () => ({ success: true }));
  assert.equal(results1[0].status, 'uploading_file');

  // 3. Document gets uploaded and confirmed
  await db.query(
    "INSERT INTO documents(id, org_id, name, storage_key, mime, sha256, size) VALUES($1, 'demo', 'damaged_proof.jpg', 'doc-storage-key-1', 'image/jpeg', 'sha256fake', 1024)",
    [fileUploadId],
  );

  // 4. Now process batch again: file exists -> execution proceeds and confirms!
  const results2 = await syncOfflineOutboxBatch(db, operatorActor, async () => ({ success: true, result: { boxId: 'new-b' } }));
  assert.equal(results2[0].status, 'confirmed');

  // 5. Visible 409 Conflict: test executor returning 409 conflict
  const opId2 = uuid();
  await inject(app, {
    method: 'POST',
    url: '/api/v1/sync/queue',
    headers: operatorHeaders,
    body: {
      operationId: opId2,
      command: 'orders.allocate',
      endpoint: '/api/v1/orders/o1/allocate',
      payload: { expectedVersion: 1, quantity: 5 },
      expectedVersion: 1,
    },
  });

  const conflictResults = await syncOfflineOutboxBatch(db, operatorActor, async (item) => {
    return {
      success: false,
      conflict: {
        serverVersion: 3,
        userExpectedVersion: 1,
        message: 'Order was modified on another terminal',
      },
    };
  });
  assert.equal(conflictResults[0].status, 'conflict');

  // Verify status in DB is 'conflict' and payload was preserved
  const outboxCheck = (await db.query("SELECT * FROM sync_outbox WHERE id = $1", [opId2])).rows[0];
  assert.equal(outboxCheck.status, 'conflict');
  assert.equal(outboxCheck.conflict_details.serverVersion, 3);
  assert.ok(outboxCheck.payload);

  // 6. User resolves conflict: Rebase and retry with new version 3
  const resolveRes = await inject(app, {
    method: 'POST',
    url: `/api/v1/sync/conflicts/${opId2}/resolve`,
    headers: operatorHeaders,
    body: p({
      resolution: 'rebase_and_retry',
      newExpectedVersion: 3,
      modifiedPayload: { expectedVersion: 3, quantity: 5 },
    }),
  });
  assert.equal(resolveRes.status, 200);
  assert.equal(resolveRes.body.status, 'queued');
  assert.equal(resolveRes.body.expected_version, 3);

  // 7. Bounded Retries: item fails up to max_attempts (5) then transitions to 'failed'
  const opId3 = uuid();
  await inject(app, {
    method: 'POST',
    url: '/api/v1/sync/queue',
    headers: operatorHeaders,
    body: {
      operationId: opId3,
      command: 'tasks.claim',
      endpoint: '/api/v1/tasks/t1/claim',
      payload: {},
    },
  });

  for (let i = 0; i < 5; i++) {
    await syncOfflineOutboxBatch(db, operatorActor, async () => ({
      success: false,
      error: 'Backend transient timeout',
    }));
  }

  const failedCheck = (await db.query("SELECT * FROM sync_outbox WHERE id = $1", [opId3])).rows[0];
  assert.equal(failedCheck.status, 'failed');
  assert.equal(failedCheck.attempts, 5);
});

// =========================================================================
// 6. Cross-Tenant and Warehouse Isolation
// =========================================================================
test('P2.6 Security & Tenancy: second company cannot access quality holds, recalls or outbox', async () => {
  // 1. Create a quality hold in company 'demo'
  const holdRes = await inject(app, {
    method: 'POST',
    url: '/api/v1/quality-holds',
    headers: supervisorHeaders,
    body: p({
      scope: 'location',
      targetId: 'l1',
      reason: 'Cross-tenant test hold',
      severity: 'minor',
    }),
  });
  assert.equal(holdRes.status, 200);
  const holdId = holdRes.body.id;

  // 2. Second company attempts to release first company's hold -> 404 / 403
  const comp2Release = await inject(app, {
    method: 'POST',
    url: `/api/v1/quality-holds/${holdId}/release`,
    headers: secondCompanyHeaders,
    body: p({
      expectedVersion: 1,
      releaseReason: 'Unauthorized cross-company release',
    }),
  });
  assert.equal(comp2Release.status, 404);

  // 3. Second company cannot read first company's outbox
  const comp2Outbox = await inject(app, {
    method: 'GET',
    url: '/api/v1/sync/outbox',
    headers: secondCompanyHeaders,
  });
  assert.equal(comp2Outbox.status, 200);
  assert.equal(comp2Outbox.body.length, 0); // Completely empty for company 2
});
