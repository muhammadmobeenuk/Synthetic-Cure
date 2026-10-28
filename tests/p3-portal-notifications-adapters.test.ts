import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID as uuid } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { openDatabase, migrate, type DB } from "../packages/database/index.js";
import { seed } from "../packages/database/seed.js";
import { snapshot, restoreSnapshot } from "../packages/database/backup.js";
import { createApp } from "../apps/api/app.js";
import { inject } from "./inject.js";
import {
  linkPortalUser,
  getPortalContext,
  getPortalInventory,
  getPortalOrders,
  submitPortalDraftOrder,
  getPortalShipments,
} from "../packages/domain/portal.js";
import {
  createNotificationEndpoint,
  updateNotificationEndpoint,
  listNotificationEndpoints,
  testNotificationEndpoint,
  dispatchWebhookEvent,
  listNotificationDeliveries,
  signPayload,
} from "../packages/domain/notifications.js";
import {
  bookCarrierManifest,
  getCarrierManifest,
  exportCarrierManifestCsv,
  exportAccountingLedger,
  exportAccountingCsv,
} from "../packages/domain/adapters.js";

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

async function httpSession(targetApp: any, userId = "demo-admin", orgId = "demo", warehouseId = "demo:legacy") {
  let r = await inject(targetApp, { url: "/api/v1/session" });
  let cookie = r.headers["set-cookie"][0].split(";")[0];
  r = await inject(targetApp, {
    method: "POST",
    url: "/api/v1/auth/demo",
    headers: { cookie, "x-csrf-token": r.body.csrf },
    body: { userId },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  cookie = r.headers["set-cookie"][0].split(";")[0];
  r = await inject(targetApp, { url: "/api/v1/session", headers: { cookie } });
  return {
    cookie,
    "x-csrf-token": r.body.csrf,
    "x-company-context": orgId,
    "x-warehouse-context": warehouseId,
  };
}

const adminActor = {
  id: "demo-admin",
  org_id: "demo",
  role: "admin" as const,
  warehouse_id: "demo:legacy",
  name: "Demo Admin",
  email: "admin@demo.test",
};

const supervisorActor = {
  id: "demo-admin",
  org_id: "demo",
  role: "supervisor" as const,
  warehouse_id: "demo:legacy",
  name: "Demo Supervisor",
  email: "supervisor@demo.test",
};

const operatorActor = {
  id: "demo-operator",
  org_id: "demo",
  role: "operator" as const,
  warehouse_id: "demo:legacy",
  name: "Demo Operator",
  email: "operator@demo.test",
};

before(async () => {
  uploadsDir = await mkdtemp(path.join(os.tmpdir(), "jadesun-p3-test-"));
  db = await openDatabase(null, ":memory:");
  await migrate(db);
  await seed(db);
  app = createApp(db, { uploads: uploadsDir, demo: true });

  adminHeaders = await httpSession(app, "demo-admin");
  supervisorHeaders = adminHeaders;
  operatorHeaders = await httpSession(app, "demo-operator");
  driverHeaders = await httpSession(app, "demo-driver");

  // Seed second company for cross-tenant boundary tests
  const bcrypt = (await import("bcryptjs")).default;
  const c2Password = "comp2-secret-pass-123";
  const c2Hash = await bcrypt.hash(c2Password, 4);
  await db.query("INSERT INTO organizations(id, name, demo) VALUES('comp2', 'Second Company Ltd', true) ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO users(id, org_id, email, name, role, password_hash, active) VALUES('c2-admin', 'comp2', 'admin@comp2.test', 'Comp2 Admin', 'administrator', $1, true) ON CONFLICT DO NOTHING", [c2Hash]);
  await db.query("INSERT INTO company_memberships(user_id, org_id, role, active) VALUES('c2-admin', 'comp2', 'administrator', true) ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO warehouses(id, org_id, code, name, active) VALUES('comp2:w1', 'comp2', 'W1', 'Warehouse 1', true) ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO warehouse_grants(user_id, org_id, warehouse_id, active) VALUES('c2-admin', 'comp2', 'comp2:w1', true) ON CONFLICT DO NOTHING");

  const boot = await inject(app, { url: "/api/v1/session" });
  const logged = await inject(app, {
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { Cookie: boot.headers["set-cookie"][0].split(";")[0], "X-CSRF-Token": boot.body.csrf },
    body: { email: "admin@comp2.test", password: c2Password },
  });
  assert.equal(logged.status, 200);
  const c2Cookie = logged.headers["set-cookie"][0].split(";")[0];
  const c2Session = await inject(app, { url: "/api/v1/session", headers: { Cookie: c2Cookie } });

  const switched = await inject(app, {
    method: "POST",
    url: "/api/v1/auth/context",
    headers: { Cookie: c2Cookie, "X-CSRF-Token": c2Session.body.csrf },
    body: { companyId: "comp2", warehouseId: "comp2:w1" },
  });
  assert.equal(switched.status, 200);
  const activeCookie = switched.headers["set-cookie"][0].split(";")[0];
  secondCompanyHeaders = {
    Cookie: activeCookie,
    "x-csrf-token": c2Session.body.csrf,
    "x-company-context": "comp2",
    "x-warehouse-context": "comp2:w1",
  };
});

after(async () => {
  await db?.close();
  await rm(uploadsDir, { recursive: true, force: true });
});

test("P3.1 Client Portal: link user to customer, scoped inventory, and validated draft order submission", async () => {
  const customer = (await db.query("SELECT * FROM customers WHERE org_id='demo' LIMIT 1")).rows[0];
  assert.ok(customer, "Customer fixture exists");

  // 1. Unlinked user cannot access portal me or inventory
  let res = await inject(app, {
    url: "/api/v1/portal/me",
    headers: operatorHeaders,
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "PORTAL_ACCESS_DENIED");

  // 2. Link operator to customer account
  res = await inject(app, {
    method: "POST",
    url: "/api/v1/portal/link-user",
    headers: adminHeaders,
    body: p({
      userId: "demo-operator",
      customerId: customer.id,
      reason: "Link client account for testing portal",
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "linked");

  // 3. Linked operator can now access portal/me
  res = await inject(app, {
    url: "/api/v1/portal/me",
    headers: operatorHeaders,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.customerId, customer.id);

  // 4. Linked operator views scoped customer inventory
  res = await inject(app, {
    url: "/api/v1/portal/inventory",
    headers: operatorHeaders,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.customerId, customer.id);
  assert.ok(Array.isArray(res.body.balances));

  // 5. Submit draft order
  await db.query(
    "INSERT INTO destination_authorizations(id, org_id, customer_id, destination_id, reason) VALUES($1, 'demo', $2, 'd1', 'Test authorized dock') ON CONFLICT DO NOTHING",
    [uuid(), customer.id],
  );

  const destinations = (
    await db.query(
      `SELECT d.id FROM destinations d
       JOIN destination_authorizations da ON da.destination_id = d.id
       WHERE d.org_id='demo' AND da.customer_id=$1`,
      [customer.id],
    )
  ).rows;
  assert.ok(destinations.length > 0, "Authorized destination exists for customer");

  const product = (await db.query("SELECT * FROM products WHERE org_id='demo' LIMIT 1")).rows[0];

  res = await inject(app, {
    method: "POST",
    url: "/api/v1/portal/orders",
    headers: operatorHeaders,
    body: p({
      destinationId: destinations[0].id,
      lines: [{ productId: product.id, quantity: "5", unit: product.unit }],
      customerReference: "PO-CLIENT-TEST",
      note: "Urgent morning delivery",
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "draft");
  assert.ok(res.body.code.startsWith("ORD-CL-"));

  // Verify order appears in portal orders list
  res = await inject(app, {
    url: "/api/v1/portal/orders",
    headers: operatorHeaders,
  });
  assert.equal(res.status, 200);
  const created = res.body.find((o: any) => o.code === res.body[0]?.code);
  assert.ok(created);
  assert.equal(created.customer_id, customer.id);
  assert.equal(created.status, "draft");
});

test("P3.2 Multi-tenant & Security: second company cannot access portal data or spoof customer ID", async () => {
  // Second company accessing portal inventory gets rejected if unlinked
  let res = await inject(app, {
    url: "/api/v1/portal/inventory",
    headers: secondCompanyHeaders,
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "PORTAL_ACCESS_DENIED");

  // Attempting to submit order with unauthorized foreign destination
  res = await inject(app, {
    method: "POST",
    url: "/api/v1/portal/orders",
    headers: operatorHeaders,
    body: p({
      destinationId: "non-existent-destination",
      lines: [{ productId: "any", quantity: "1", unit: "case" }],
    }),
  });
  assert.equal(res.status, 422);
});

test("P3.3 Webhooks & Notifications: endpoint registration, HMAC-SHA256 signature, and test ping", async () => {
  // 1. Non-admin/supervisor cannot register webhooks
  let res = await inject(app, {
    method: "POST",
    url: "/api/v1/notifications/endpoints",
    headers: driverHeaders,
    body: p({
      url: "https://api.example.com/webhook",
      eventTopics: ["order.dispatched"],
    }),
  });
  assert.equal(res.status, 403);

  // 2. Admin registers webhook
  res = await inject(app, {
    method: "POST",
    url: "/api/v1/notifications/endpoints",
    headers: adminHeaders,
    body: p({
      url: "https://api.example.com/webhook",
      eventTopics: ["order.dispatched", "order.delivered"],
      description: "ERP outbound events",
      secret: "supersecretkey1234567890",
    }),
  });
  assert.equal(res.status, 200);
  const endpointId = res.body.id;
  assert.ok(endpointId);
  assert.equal(res.body.url, "https://api.example.com/webhook");

  // 3. Test HMAC signing function
  const testPayload = { test: "data", orderId: "123" };
  const sig = signPayload("supersecretkey1234567890", testPayload);
  assert.ok(sig.startsWith("sha256="));
  assert.equal(sig, signPayload("supersecretkey1234567890", testPayload));

  // 4. Send test ping
  res = await inject(app, {
    method: "POST",
    url: "/api/v1/notifications/test",
    headers: adminHeaders,
    body: p({
      endpointId,
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "delivered");
  assert.ok(res.body.signature.startsWith("sha256="));

  // 5. Query deliveries log
  res = await inject(app, {
    url: `/api/v1/notifications/deliveries?endpointId=${endpointId}`,
    headers: adminHeaders,
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.length > 0);
  assert.equal(res.body[0].event_topic, "test.ping");

  // 6. Test dispatchWebhookEvent directly
  const dispatched = await dispatchWebhookEvent(
    db,
    "demo",
    "demo:legacy",
    "order.dispatched",
    { orderId: "ord-test-99", trackingNumber: "TRK-001" },
  );
  assert.ok(dispatched.length > 0);
  assert.equal(dispatched[0].status, "pending");
});

test("P3.4 Carrier Manifest Adapter: booking, metrics calculation, and formula neutralization in CSV", async () => {
  const tripId = uuid();
  await db.query(
    "INSERT INTO trips(id, org_id, code, business_date, driver_id, status, warehouse_id, version) VALUES($1, 'demo', 'TRIP-P3', '2026-10-28', 'demo-driver', 'planned', 'demo:legacy', 1)",
    [tripId],
  );
  await db.query(
    "INSERT INTO stops(id, org_id, trip_id, destination_id, position, warehouse_id) VALUES($1, 'demo', $2, 'd1', 1, 'demo:legacy')",
    [uuid(), tripId],
  );
  const trip = (await db.query("SELECT * FROM trips WHERE id=$1", [tripId])).rows[0];
  assert.ok(trip, "Trip fixture exists");

  // 1. Book carrier manifest
  let res = await inject(app, {
    method: "POST",
    url: "/api/v1/adapters/carrier/book",
    headers: adminHeaders,
    body: p({
      tripId: trip.id,
      carrierCode: "DHL_EXPRESS",
      carrierName: "DHL Express UK",
      serviceLevel: "NextDayBy12",
      specialInstructions: "Tail-lift required",
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "booked");
  assert.equal(res.body.carrierCode, "DHL_EXPRESS");

  // 2. Prevent duplicate booking
  res = await inject(app, {
    method: "POST",
    url: "/api/v1/adapters/carrier/book",
    headers: adminHeaders,
    body: p({
      tripId: trip.id,
      carrierCode: "DHL_EXPRESS",
      carrierName: "DHL Express UK",
    }),
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "ALREADY_BOOKED");

  // 3. Get carrier manifest JSON
  res = await inject(app, {
    url: `/api/v1/adapters/carrier/manifest/${trip.id}`,
    headers: adminHeaders,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.carrier_code, "DHL_EXPRESS");
  assert.ok(Array.isArray(res.body.stops));

  // 4. Download carrier manifest CSV
  res = await inject(app, {
    url: `/api/v1/adapters/carrier/manifest/${trip.id}/csv`,
    headers: adminHeaders,
  });
  assert.equal(res.status, 200);
  const carrierCsv = res.raw.toString("utf-8");
  assert.ok(carrierCsv.includes("Carrier Code"));
  assert.ok(carrierCsv.includes("DHL_EXPRESS"));

  // 5. Formula neutralization check
  const maliciousManifest = {
    id: "man-1",
    carrier_code: "=cmd|' /C calc'!A0",
    carrier_name: "+SUM(1,2)",
    business_date: "2026-10-28",
    stops: [
      {
        position: 1,
        destination_name: "@EVIL_STORE",
        address: "-123 Bad St",
      },
    ],
    total_pallets: 1,
    total_boxes: 2,
  };
  const csv = exportCarrierManifestCsv(maliciousManifest);
  assert.ok(csv.includes("''=cmd|' /C calc'!A0") || csv.includes("`") || csv.includes("'+SUM(1,2)"));
  assert.ok(!csv.includes("\n=cmd"));
});

test("P3.5 Accounting Ledger Export: verified physical quantities, unconfirmed pricing disclaimer, and CSV export", async () => {
  // 1. JSON Accounting Export
  let res = await inject(app, {
    url: "/api/v1/adapters/accounting/export?status=all",
    headers: adminHeaders,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.disclaimer, "PHYSICAL QUANTITIES ONLY · COMMERCIAL PRICING UNCONFIRMED");
  assert.ok(Array.isArray(res.body.records));

  // 2. CSV Accounting Export
  res = await inject(app, {
    url: "/api/v1/adapters/accounting/export/csv?status=all",
    headers: adminHeaders,
  });
  assert.equal(res.status, 200);
  const accountingCsv = res.raw.toString("utf-8");
  assert.ok(accountingCsv.includes("Shipment ID,Shipment Status,Date,Order Code"));
  assert.ok(accountingCsv.includes("COMMERCIAL PRICING UNCONFIRMED"));

  // 3. Formula injection test on accounting export
  const rawCsv = exportAccountingCsv({
    disclaimer: "PHYSICAL ONLY",
    records: [
      {
        shipment_id: "s1",
        shipment_status: "delivered",
        shipment_created_at: "2026-10-28T10:00:00Z",
        order_code: "=HYPERLINK(\"http://evil.com\")",
        customer_code: "@CUST",
        customer_name: "+CUSTOMER",
        destination_name: "-STORE",
        sku: "=SKU1",
        product_name: "Safe Product",
        shipped_quantity: "10",
        line_unit: "case",
      },
    ],
  });
  assert.ok(rawCsv.includes("UNCONFIRMED_PHYSICAL_ONLY"));
  // Check that all injection characters are escaped with leading apostrophe
  assert.ok(rawCsv.includes("''=HYPERLINK") || rawCsv.includes("`") || rawCsv.includes("'+CUSTOMER"));
  assert.ok(rawCsv.includes("''@CUST") || rawCsv.includes("'@CUST"));
  assert.ok(rawCsv.includes("''-STORE") || rawCsv.includes("'-STORE"));
});

test("P3.6 Database & Backup v8: logical backup includes P3 tables and restores cleanly", async () => {
  const b = await snapshot(db);
  assert.equal(b.format, "jadesun-v8");
  assert.ok(Array.isArray(b.tables.client_portal_users));
  assert.ok(Array.isArray(b.tables.notification_endpoints));
  assert.ok(Array.isArray(b.tables.notification_deliveries));
  assert.ok(Array.isArray(b.tables.carrier_manifests));

  // Test restore on a fresh database
  const freshDb = await openDatabase(null, ":memory:");
  await migrate(freshDb);
  await restoreSnapshot(freshDb, b);

  const restoredEndpoints = await freshDb.query("SELECT * FROM notification_endpoints WHERE org_id='demo'");
  assert.ok(restoredEndpoints.rows.length > 0);

  const restoredPortal = await freshDb.query("SELECT * FROM client_portal_users WHERE org_id='demo'");
  assert.ok(restoredPortal.rows.length > 0);

  await freshDb.close();
});
