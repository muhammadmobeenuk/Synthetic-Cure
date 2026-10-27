import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID as uuid, createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { openDatabase, migrate, type DB } from "../packages/database/index.js";
import { seed } from "../packages/database/seed.js";
import {
  snapshot,
  restoreSnapshot,
  writeBackup,
  restoreBackup,
} from "../packages/database/backup.js";
import {
  services,
  command,
  owned,
  boxState,
  authorize,
  type Actor,
} from "../packages/domain/services.js";
import { quantitySum, businessDate } from "../packages/domain/index.js";
import { createApp } from "../apps/api/app.js";
import { workOnce } from "../apps/worker/index.js";
import { ocrStatus, extractDocument } from "../apps/worker/ocr.js";
import { inject } from "./inject.js";
process.env.NODE_ENV = "test";
let db: DB;
let raceDB: DB;
const admin: Actor = {
  id: "demo-admin",
  org_id: "demo",
  role: "administrator",
  name: "Demo",
  email: "demo@example.invalid",
};
let box: any, duplicatePayload: any;
const p = (more: any = {}) => ({ clientOperationId: uuid(), ...more });
async function call(name: string, payload: any, fn: (t: DB) => Promise<any>) {
  return command(db, admin, name, payload, fn);
}
before(async () => {
  db = await openDatabase(process.env.TEST_DATABASE_URL || null, ":memory:");
  if (db.native) {
    const existing = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    assert.equal(existing.rows.length, 0, "Native test database must be empty before migrations");
    assert.ok(process.env.TEST_RESTORE_DATABASE_URL, "Supply a separate empty TEST_RESTORE_DATABASE_URL for native restore");
  }
  await migrate(db);
  raceDB = db.native ? await openDatabase(process.env.TEST_DATABASE_URL!) : db;
  await seed(db);
  await db.query(
    "UPDATE destinations SET address='Synthetic QA destination · not a real address',verified=true WHERE org_id='demo'",
  );
});
after(async () => {
  if (raceDB && raceDB !== db) await raceDB.close();
  if (db) await db.close();
});
test("decimal totals retain unknown counts and do not turn unknown into zero", () => {
  assert.deepEqual(quantitySum(["100", "75", null]), {
    confirmed: "175",
    unconfirmed: 1,
  });
  assert.deepEqual(quantitySum(["0.1", "0.2"]), {
    confirmed: "0.3",
    unconfirmed: 0,
  });
});
test("Europe/London business date across both daylight-saving transitions", () => {
  assert.equal(businessDate(new Date("2026-03-29T23:30:00Z")), "2026-03-30");
  assert.equal(businessDate(new Date("2026-10-25T00:30:00Z")), "2026-10-25");
  assert.equal(businessDate(new Date("2026-10-25T23:30:00Z")), "2026-10-25");
});
test("duplicate receipt and canonical replay create one stable physical identity", async () => {
  duplicatePayload = p({
    customerId: "c3",
    locationId: "l1",
    sourceLabel: "Test original label 1/3",
    condition: "good",
    contents: [
      { productId: "p1", quantity: "20", unit: "piece", verified: true },
    ],
  });
  const before = (await db.query("SELECT count(*)::int n FROM boxes")).rows[0]
    .n;
  box = await call("receipt-test", duplicatePayload, (t) =>
    services.receipt(t, admin, duplicatePayload),
  );
  const again = await call("receipt-test", { ...duplicatePayload }, (t) =>
    services.receipt(t, admin, duplicatePayload),
  );
  assert.equal(again.id, box.id);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM boxes")).rows[0].n,
    before + 1,
  );
});
test("changed payload cannot reuse an idempotency key", async () => {
  await assert.rejects(
    call(
      "receipt-test",
      { ...duplicatePayload, sourceLabel: "different" },
      (t) => services.receipt(t, admin, duplicatePayload),
    ),
    (e: any) => e.status === 409 && e.code === "IDEMPOTENCY_MISMATCH",
  );
});
test("unknown pack size remains unknown and cannot allocate stock", async () => {
  const ct = (
    await db.query(
      "SELECT c.quantity,p.pack_size,p.pack_verified FROM contents c JOIN products p ON p.id=c.product_id WHERE c.id='ct4'",
    )
  ).rows[0];
  assert.equal(ct.quantity, null);
  assert.equal(ct.pack_size, null);
  const a = p({
    expectedVersion: 1,
    boxId: "b4",
    orderLineId: "ol1",
    quantity: "25",
  });
  await assert.rejects(
    call("unknown-allocate", a, (t) => services.allocate(t, admin, "o1", a)),
    (e: any) => e.code === "UNAVAILABLE",
  );
});
test("two concurrent moves: one wins; stale command returns current version", async () => {
  const a = p({
      expectedVersion: box.version,
      locationId: "l2",
      reason: "Physical move A",
    }),
    b = p({
      expectedVersion: box.version,
      locationId: "l3",
      reason: "Physical move B",
    });
  const results = await Promise.allSettled([
    call("race-move:" + box.id, a, (t) =>
      services.move(t, admin, "boxes", box.id, a),
    ),
    command(raceDB, admin, "race-move:" + box.id, b, (t) =>
      services.move(t, admin, "boxes", box.id, b),
    ),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  const failed = results.find(
    (x) => x.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal(failed.reason.status, 409);
  assert.equal(failed.reason.details.current.version, 2);
});
test("offline replay movement is idempotent", async () => {
  const b = await owned(db, "boxes", box.id, admin);
  const a = p({
    expectedVersion: b.version,
    locationId: "l1",
    reason: "Replay test",
  });
  const one = await call("move-replay", a, (t) =>
    services.move(t, admin, "boxes", box.id, a),
  );
  const two = await call("move-replay", a, (t) =>
    services.move(t, admin, "boxes", box.id, a),
  );
  assert.equal(one.version, two.version);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM inventory_events WHERE entity_id=$1 AND data->>'reason'='Replay test'",
        [box.id],
      )
    ).rows[0].n,
    1,
  );
});
test("moving a pallet changes effective locations; removing one preserves others", async () => {
  const old = await owned(db, "pallets", "pal1", admin);
  let a = p({
    expectedVersion: old.version,
    locationId: "l2",
    reason: "Move entire pallet",
  });
  await call("pallet-move", a, (t) =>
    services.move(t, admin, "pallets", "pal1", a),
  );
  assert.equal((await boxState(db, admin, "b7")).effective_location_id, "l2");
  assert.equal((await boxState(db, admin, "b8")).effective_location_id, "l2");
  const pal = await owned(db, "pallets", "pal1", admin);
  a = p({ expectedVersion: pal.version, boxIds: ["b7"], locationId: "l1" });
  await call("pallet-remove", a, (t) =>
    services.membership(t, admin, "pal1", a, true),
  );
  assert.equal((await boxState(db, admin, "b7")).effective_location_id, "l1");
  assert.equal((await boxState(db, admin, "b8")).pallet_id, "pal1");
  assert.equal((await boxState(db, admin, "b8")).effective_location_id, "l2");
});
test("one box cannot belong to two pallets and nesting is unsupported", async () => {
  const pal = await owned(db, "pallets", "pal2", admin);
  const a = p({ expectedVersion: pal.version, boxIds: ["b8"] });
  await assert.rejects(
    call("double-pallet", a, (t) => services.membership(t, admin, "pal2", a)),
    (e: any) => e.status === 409,
  );
  assert.equal((await owned(db, "boxes", "b8", admin)).pallet_id, "pal1");
});
test("concurrent allocation of last box succeeds once", async () => {
  const a = p({
      expectedVersion: 1,
      boxId: "b1",
      orderLineId: "ol1",
      quantity: "25",
    }),
    b = p({
      expectedVersion: 1,
      boxId: "b1",
      orderLineId: "ol1",
      quantity: "25",
    });
  const results = await Promise.allSettled([
    call("allocate-race-a", a, (t) => services.allocate(t, admin, "o1", a)),
    command(raceDB, admin, "allocate-race-b", b, (t) => services.allocate(t, admin, "o1", b)),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM allocations WHERE box_id='b1'",
      )
    ).rows[0].n,
    1,
  );
});
test("order cancellation releases allocations with retained event", async () => {
  const o = await owned(db, "orders", "o1", admin);
  const a = p({
    expectedVersion: o.version,
    reason: "Cancelled sample request",
  });
  await call("cancel-test", a, (t) => services.cancel(t, admin, "o1", a));
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM allocations WHERE order_id='o1'",
      )
    ).rows[0].n,
    0,
  );
  assert.equal((await owned(db, "orders", "o1", admin)).status, "cancelled");
});
test("repacking conserves exact quantity and creates a different box identity", async () => {
  const b = await boxState(db, admin, box.id);
  const a = p({
    expectedVersion: b.version,
    contentsId: b.contents[0].id,
    quantity: "7.25",
    locationId: "l1",
    reason: "Split for sample order",
  });
  const result = await call("repack-test", a, (t) =>
    services.repack(t, admin, b.id, a),
  );
  assert.notEqual(result.created.id, b.id);
  assert.equal(
    quantitySum([
      result.source.contents[0].quantity,
      result.created.contents[0].quantity,
    ]).confirmed,
    "20",
  );
});
let shippingOrder: any, ship: any, trip: any;
test("dated preparation selects existing orders only and never repeats them", async () => {
  const count = (await db.query("SELECT count(*)::int n FROM orders")).rows[0]
    .n;
  assert.equal(count, 3);
  const bad = p({ businessDate: "2026-11-04", orderIds: ["o2"] });
  await assert.rejects(
    call("duplicate-batch", bad, (t) => services.preparation(t, admin, bad)),
    (e: any) => e.code === "ALREADY_PLANNED",
  );
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM orders")).rows[0].n,
    3,
  );
});
test("Wednesday workflow reaches ready without dispatch; physical staging required", async () => {
  const create = p({
    customerId: "c1",
    destinationId: "d1",
    lines: [{ productId: "p2", quantity: "10", unit: "kg" }],
  });
  shippingOrder = await call("shipping-order", create, (t) =>
    services.order(t, admin, create),
  );
  const line = (
    await db.query("SELECT * FROM order_lines WHERE order_id=$1", [
      shippingOrder.id,
    ])
  ).rows[0];
  const batch = p({ businessDate: "2026-10-28", orderIds: [shippingOrder.id] });
  const prep = await call("shipping-prep", batch, (t) =>
    services.preparation(t, admin, batch),
  );
  let o = await owned(db, "orders", shippingOrder.id, admin);
  const allocation = p({
    expectedVersion: o.version,
    boxId: "b5",
    orderLineId: line.id,
    quantity: "10",
  });
  await call("shipping-allocate", allocation, (t) =>
    services.allocate(t, admin, o.id, allocation),
  );
  for (const stage of ["picking", "packing", "checking"]) {
    o = await owned(db, "orders", shippingOrder.id, admin);
    const a = p({ expectedVersion: o.version, stage });
    await call("shipping-stage:" + stage, a, (t) =>
      services.advance(t, admin, prep.id, o.id, a),
    );
  }
  o = await owned(db, "orders", shippingOrder.id, admin);
  let a = p({
    expectedVersion: o.version,
    stage: "ready",
    stagingLocationId: "l3",
  });
  await assert.rejects(
    call("not-staged", a, (t) => services.advance(t, admin, prep.id, o.id, a)),
    (e: any) => e.code === "NOT_STAGED",
  );
  const b = await owned(db, "boxes", "b5", admin);
  const m = p({
    expectedVersion: b.version,
    locationId: "l3",
    reason: "Physically staged for checking",
  });
  await call("stage-box", m, (t) => services.move(t, admin, "boxes", b.id, m));
  a = p({
    expectedVersion: o.version,
    stage: "ready",
    stagingLocationId: "l3",
  });
  await call("ready-stage", a, (t) =>
    services.advance(t, admin, prep.id, o.id, a),
  );
  ship = (await db.query("SELECT * FROM shipments WHERE order_id=$1", [o.id]))
    .rows[0];
  assert.equal(ship.status, "ready");
  assert.equal((await owned(db, "boxes", "b5", admin)).status, "confirmed");
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM trips")).rows[0].n,
    0,
  );
});
test("unrelated box rejected; duplicate load does not change physical box count", async () => {
  let a = p({ expectedVersion: ship.version, boxId: "b6" });
  await assert.rejects(
    call("wrong-load", a, (t) => services.load(t, admin, ship.id, a)),
    (e: any) => e.code === "WRONG_SHIPMENT",
  );
  const count = (await db.query("SELECT count(*)::int n FROM boxes")).rows[0].n;
  a = p({ expectedVersion: ship.version, boxId: "b5" });
  ship = await call("right-load", a, (t) =>
    services.load(t, admin, ship.id, a),
  );
  const again = await call("right-load", a, (t) =>
    services.load(t, admin, ship.id, a),
  );
  assert.equal(again.version, ship.version);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM boxes")).rows[0].n,
    count,
  );
});
test("driver assignment history and separate custody dispatch", async () => {
  const pTrip = p({
    businessDate: "2026-10-30",
    driverId: "demo-driver",
    vehicle: "DEMO-VAN",
    shipmentIds: [ship.id],
  });
  trip = await call("trip-test", pTrip, (t) => services.trip(t, admin, pTrip));
  const assignment = p({
    expectedVersion: trip.version,
    driverId: "demo-driver",
    reason: "Confirmed sample assignment",
  });
  const { createApp } = await import("../apps/api/app.js");
  assert.ok(createApp); // API reassignment covered separately below
  await db.transaction((t) =>
    t.query(
      "INSERT INTO inventory_events(id,org_id,actor_id,entity_id,kind,data) VALUES($1,$2,$3,$4,$5,$6)",
      [
        uuid(),
        admin.org_id,
        admin.id,
        trip.id,
        "trip.driver_reassigned",
        JSON.stringify({
          from: null,
          to: "demo-driver",
          reason: assignment.reason,
        }),
      ],
    ),
  );
  ship = await owned(db, "shipments", ship.id, admin);
  const a = p({ expectedVersion: ship.version });
  ship = await call("dispatch-test", a, (t) =>
    services.dispatch(t, admin, ship.id, a),
  );
  assert.equal(ship.status, "dispatched");
  assert.equal((await owned(db, "boxes", "b5", admin)).status, "dispatched");
  assert.ok(
    (
      await db.query(
        "SELECT id FROM inventory_events WHERE entity_id=$1 AND kind=$2",
        [trip.id, "trip.driver_reassigned"],
      )
    ).rows.length,
  );
});
test("partial delivery keeps outstanding; returns stay held", async () => {
  const line = (
    await db.query("SELECT * FROM shipment_lines WHERE shipment_id=$1", [
      ship.id,
    ])
  ).rows[0];
  const driver = { ...admin, id: "demo-driver", role: "driver" };
  let a = p({
    expectedVersion: ship.version,
    lines: [{ lineId: line.id, delivered: "6", returned: "0" }],
    note: "Sample recipient accepted six kilograms",
  });
  ship = await command(db, driver, "handover-test", a, (t) =>
    services.handover(t, driver, ship.id, a),
  );
  assert.equal(ship.status, "partial");
  let l = await owned(db, "shipment_lines", line.id, admin);
  assert.equal(
    Number(l.quantity) - Number(l.delivered) - Number(l.returned),
    4,
  );
  a = p({
    expectedVersion: ship.version,
    lines: [{ lineId: line.id, delivered: "0", returned: "4" }],
    note: "Remaining sample quantity returned for review",
  });
  ship = await command(db, driver, "return-test", a, (t) =>
    services.handover(t, driver, ship.id, a),
  );
  assert.equal(ship.status, "completed");
  assert.equal((await owned(db, "boxes", "b5", admin)).status, "returned");
  assert.equal((await owned(db, "boxes", "b5", admin)).condition, "hold");
});
test("checked pallet membership changes invalidate verification", async () => {
  let pal = await owned(db, "pallets", "pal1", admin);
  let a = p({ expectedVersion: pal.version });
  pal = await call("verify-pal", a, (t) =>
    services.verifyPallet(t, admin, pal.id, a),
  );
  assert.equal(pal.checked_revision, pal.manifest_revision);
  a = p({ expectedVersion: pal.version, boxIds: ["b7"] });
  pal = await call("change-pal", a, (t) =>
    services.membership(t, admin, pal.id, a),
  );
  assert.equal(pal.checked_revision, null);
  assert.ok(pal.manifest_revision > 1);
});
test("immutable audit events reject silent overwrites", async () => {
  await assert.rejects(
    db.query(
      "UPDATE inventory_events SET kind='tampered' WHERE id='seed-event'",
    ),
    /immutable/,
  );
});
test("foreign organization references and role elevation rejected", async () => {
  await assert.rejects(
    owned(db, "boxes", "b1", { ...admin, org_id: "foreign" }),
    (e: any) => e.status === 404,
  );
  assert.throws(
    () => authorize({ ...admin, role: "operator" }, "adjust"),
    (e: any) => e.status === 403,
  );
  assert.throws(
    () => authorize({ ...admin, role: "reviewer" }, "receive"),
    (e: any) => e.status === 403,
  );
});
test("failed receipt transaction leaves no partial box or event", async () => {
  const count = (await db.query("SELECT count(*)::int n FROM boxes")).rows[0].n;
  const a = p({
    customerId: null,
    locationId: "l1",
    condition: "good",
    sourceLabel: "Invalid unit",
    contents: [{ productId: "p1", quantity: "2", unit: "kg", verified: true }],
  });
  await assert.rejects(
    call("invalid-unit", a, (t) => services.receipt(t, admin, a)),
    (e: any) => e.code === "UNIT_MISMATCH",
  );
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM boxes")).rows[0].n,
    count,
  );
});
test("database-backed export reaches completed authoritative result", async () => {
  const id = uuid();
  await db.query(
    "INSERT INTO jobs(id,org_id,actor_id,kind) VALUES($1,'demo','demo-admin','inventory-export')",
    [id],
  );
  await workOnce(db);
  const j = await owned(db, "jobs", id, admin);
  assert.equal(j.status, "completed");
  assert.ok(j.result.boxes.length > 0);
});
test("backup and restore recover domain data plus private file hash", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "jadesun-restore-"));
  const files = path.join(temp, "private");
  await mkdir(files);
  const key = uuid(),
    bytes = Buffer.from("synthetic private evidence");
  await writeFile(path.join(files, key), bytes);
  await db.query(
    "INSERT INTO documents(id,org_id,box_id,name,storage_key,mime,sha256,size) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      uuid(),
      "demo",
      "b1",
      "sample.txt",
      key,
      "application/octet-stream",
      createHash("sha256").update(bytes).digest("hex"),
      bytes.length,
    ],
  );
  const target = await openDatabase(db.native ? process.env.TEST_RESTORE_DATABASE_URL! : null, ":memory:");
  try {
    if (target.native) assert.equal((await target.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.length, 0, "Restore test database must be empty");
    await migrate(target);
    const filename = path.join(temp, "backup.json");
    await writeBackup(db, filename, files);
    const restoredFiles = path.join(temp, "restored-private");
    await restoreBackup(target, filename, restoredFiles);
    assert.equal(
      (await target.query("SELECT count(*)::int n FROM boxes")).rows[0].n,
      (await db.query("SELECT count(*)::int n FROM boxes")).rows[0].n,
    );
    assert.equal(
      (await readFile(path.join(restoredFiles, key))).toString(),
      bytes.toString(),
    );
    assert.equal(
      (await target.query("SELECT count(*)::int n FROM inventory_events"))
        .rows[0].n,
      (await db.query("SELECT count(*)::int n FROM inventory_events")).rows[0]
        .n,
    );
    await assert.rejects(restoreSnapshot(target, await snapshot(db)), /empty/);
  } finally {
    await target.close();
    await rm(temp, { recursive: true, force: true });
  }
});
test("HTTP sessions, CSRF, authorization, private documents and foreign IDs", async () => {
  const app = createApp(db, { demo: true });
  let r = await inject(app, { url: "/api/v1/workspace" });
  assert.equal(r.status, 401);
  r = await inject(app, { url: "/api/v1/session" });
  assert.equal(r.status, 200);
  let cookie = r.headers["set-cookie"][0].split(";")[0],
    csrf = r.body.csrf;
  r = await inject(app, {
    method: "POST",
    url: "/api/v1/auth/demo",
    headers: { cookie },
    body: { userId: "demo-reviewer" },
  });
  assert.equal(r.status, 403);
  r = await inject(app, {
    method: "POST",
    url: "/api/v1/auth/demo",
    headers: { cookie, "x-csrf-token": csrf },
    body: { userId: "demo-reviewer" },
  });
  assert.equal(r.status, 200);
  cookie = r.headers["set-cookie"][0].split(";")[0];
  r = await inject(app, { url: "/api/v1/session", headers: { cookie } });
  csrf = r.body.csrf;
  r = await inject(app, {
    method: "POST",
    url: "/api/v1/receipts",
    headers: { cookie, "x-csrf-token": csrf },
    body: duplicatePayload,
  });
  assert.equal(r.status, 403);
  r = await inject(app, {
    url: "/api/v1/documents/foreign-document/file",
    headers: { cookie },
  });
  assert.equal(r.status, 404);
  r = await inject(app, {
    url: "/api/v1/boxes/foreign-box",
    headers: { cookie },
  });
  assert.equal(r.status, 404);
  r = await inject(app, { url: "/api/v1/workspace", headers: { cookie } });
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.body.users).includes("password_hash"));
});
test("HTTP driver list returns assigned trip only and denies source documents", async () => {
  const app = createApp(db, { demo: true });
  let r = await inject(app, { url: "/api/v1/session" });
  let cookie = r.headers["set-cookie"][0].split(";")[0];
  r = await inject(app, {
    method: "POST",
    url: "/api/v1/auth/demo",
    headers: { cookie, "x-csrf-token": r.body.csrf },
    body: { userId: "demo-driver" },
  });
  cookie = r.headers["set-cookie"][0].split(";")[0];
  r = await inject(app, { url: "/api/v1/workspace", headers: { cookie } });
  assert.equal(r.status, 200);
  assert.ok(r.body.trips.every((t: any) => t.driver_id === "demo-driver"));
  assert.equal(r.body.customers, undefined);
  assert.equal(r.body.documents, undefined);
  r = await inject(app, { url: "/api/v1/boxes/b1", headers: { cookie } });
  assert.equal(r.status, 403);
});
async function httpSession(app: any, userId = "demo-admin") {
  let r = await inject(app, { url: "/api/v1/session" });
  let cookie = r.headers["set-cookie"][0].split(";")[0];
  r = await inject(app, {
    method: "POST",
    url: "/api/v1/auth/demo",
    headers: { cookie, "x-csrf-token": r.body.csrf },
    body: { userId },
  });
  assert.equal(r.status, 200);
  cookie = r.headers["set-cookie"][0].split(";")[0];
  r = await inject(app, { url: "/api/v1/session", headers: { cookie } });
  return { cookie, "x-csrf-token": r.body.csrf };
}
test("actual HTTP driver reassignment preserves before/after audit history", async () => {
  const app = createApp(db, { demo: true });
  const headers = await httpSession(app);
  const before = await owned(db, "trips", trip.id, admin);
  const r = await inject(app, {
    method: "POST",
    url: "/api/v1/trips/" + trip.id + "/reassign",
    headers,
    body: p({
      expectedVersion: before.version,
      driverId: "demo-driver",
      reason: "Verified reassignment test",
    }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.version, before.version + 1);
  const ev = (
    await db.query(
      "SELECT data FROM inventory_events WHERE entity_id=$1 AND kind='trip.driver_reassigned' AND data->>'reason'='Verified reassignment test'",
      [trip.id],
    )
  ).rows[0];
  assert.equal(ev.data.from, "demo-driver");
  assert.equal(ev.data.to, "demo-driver");
});
test("mixed-customer pallet manifests load onto one permitted trip", async () => {
  const boxIds: string[] = [],
    orders: any[] = [];
  for (const [customerId, destinationId, productId, qty] of [
    ["c3", "d3", "p1", "5"],
    ["c2", "d2", "p3", "6"],
  ]) {
    let a = p({
      customerId,
      locationId: "l3",
      sourceLabel: "Mixed-load synthetic box",
      condition: "good",
      contents: [{ productId, quantity: qty, unit: "piece", verified: true }],
    });
    const b = await call("mixed-receipt:" + customerId, a, (t) =>
      services.receipt(t, admin, a),
    );
    boxIds.push(b.id);
    a = p({
      customerId,
      destinationId,
      lines: [{ productId, quantity: qty, unit: "piece" }],
    });
    const o = await call("mixed-order:" + customerId, a, (t) =>
      services.order(t, admin, a),
    );
    const line = (
      await db.query("SELECT * FROM order_lines WHERE order_id=$1", [o.id])
    ).rows[0];
    a = p({
      expectedVersion: o.version,
      boxId: b.id,
      orderLineId: line.id,
      quantity: qty,
    });
    await call("mixed-allocate:" + o.id, a, (t) =>
      services.allocate(t, admin, o.id, a),
    );
    orders.push(o);
  }
  let a = p({ locationId: "l3" });
  let pallet = await call("mixed-pallet", a, (t) =>
    services.pallet(t, admin, a),
  );
  a = p({ expectedVersion: pallet.version, boxIds });
  pallet = await call("mixed-member", a, (t) =>
    services.membership(t, admin, pallet.id, a),
  );
  a = p({ expectedVersion: pallet.version });
  pallet = await call("mixed-check", a, (t) =>
    services.verifyPallet(t, admin, pallet.id, a),
  );
  a = p({ businessDate: "2026-11-04", orderIds: orders.map((o) => o.id) });
  const prep = await call("mixed-prep", a, (t) =>
    services.preparation(t, admin, a),
  );
  for (const o of orders)
    for (const stage of ["picking", "packing", "checking", "ready"]) {
      const latest = await owned(db, "orders", o.id, admin);
      const cmd = p({
        expectedVersion: latest.version,
        stage,
        stagingLocationId: "l3",
      });
      await call("mixed-stage:" + o.id + ":" + stage, cmd, (t) =>
        services.advance(t, admin, prep.id, o.id, cmd),
      );
    }
  const shipments = (
    await db.query(
      "SELECT * FROM shipments WHERE order_id=ANY($1::text[]) ORDER BY id",
      [orders.map((o) => o.id)],
    )
  ).rows;
  a = p({
    businessDate: "2026-11-06",
    driverId: "demo-driver",
    vehicle: "DEMO-MIXED",
    shipmentIds: shipments.map((s) => s.id),
  });
  const tr = await call("mixed-trip", a, (t) => services.trip(t, admin, a));
  for (const s of shipments) {
    let latest = await owned(db, "shipments", s.id, admin);
    const line = (
      await db.query("SELECT * FROM shipment_lines WHERE shipment_id=$1", [
        s.id,
      ])
    ).rows[0];
    a = p({ expectedVersion: latest.version, boxId: line.box_id });
    await call("mixed-load:" + s.id, a, (t) =>
      services.load(t, admin, s.id, a),
    );
  }
  for (const s of shipments) {
    const latest = await owned(db, "shipments", s.id, admin);
    a = p({ expectedVersion: latest.version });
    const dispatched = await call("mixed-dispatch:" + s.id, a, (t) =>
      services.dispatch(t, admin, s.id, a),
    );
    assert.equal(dispatched.status, "dispatched");
    assert.equal(dispatched.trip_id, tr.id);
  }
  assert.equal(
    (
      await db.query(
        "SELECT count(DISTINCT customer_id)::int n FROM boxes WHERE pallet_id=$1",
        [pallet.id],
      )
    ).rows[0].n,
    2,
  );
});
test("HTTP count submission persists unique observations and review without stock adjustment", async () => {
  const app = createApp(db, { demo: true }),
    headers = await httpSession(app);
  const count = (await db.query("SELECT count(*)::int n FROM boxes")).rows[0].n;
  const body = p({
    locationId: "l2",
    observedCodes: ["BOX-00001", "BOX-00001", "UNEXPECTED-BOX"],
  });
  let r = await inject(app, {
    method: "POST",
    url: "/api/v1/counts",
    headers,
    body,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.observedCount, 2);
  assert.equal(r.body.stockAdjusted, false);
  const again = await inject(app, {
    method: "POST",
    url: "/api/v1/counts",
    headers,
    body,
  });
  assert.equal(again.body.id, r.body.id);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM boxes")).rows[0].n,
    count,
  );
  assert.ok(r.body.unexpected.includes("UNEXPECTED-BOX"));
});
test("HTTP return disposition needs supervisor permission and releases only returned quantity", async () => {
  const app = createApp(db, { demo: true });
  const operator = await httpSession(app, "demo-operator");
  const b = await owned(db, "boxes", "b5", admin);
  const body = p({
    expectedVersion: b.version,
    disposition: "release",
    locationId: "l1",
    reason: "Inspected the four returned kilograms",
  });
  let r = await inject(app, {
    method: "POST",
    url: "/api/v1/returns/b5/disposition",
    headers: operator,
    body,
  });
  assert.equal(r.status, 403);
  r = await inject(app, {
    method: "POST",
    url: "/api/v1/returns/b5/disposition",
    headers: await httpSession(app),
    body,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "confirmed");
  assert.equal(Number(r.body.contents[0].quantity), 4);
  assert.equal(r.body.pallet_id, null);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM allocations WHERE box_id='b5'",
      )
    ).rows[0].n,
    0,
  );
});
test("photo upload validates signatures, retries once, stays private, and survives upload failure", async () => {
  const request = (await import("supertest")).default;
  const temp = await mkdtemp(path.join(os.tmpdir(), "jadesun-upload-"));
  try {
    const app = createApp(db, { demo: true, uploads: temp });
    const headers = await httpSession(app);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9kAAAAASUVORK5CYII=",
      "base64",
    );
    const op = uuid();
    let r = await request(app)
      .post("/api/v1/boxes/b1/photo")
      .set(headers)
      .field("clientOperationId", op)
      .attach("file", Buffer.from("not an image"), {
        filename: "fake.png",
        contentType: "image/png",
      });
    assert.equal(r.status, 422);
    r = await request(app)
      .post("/api/v1/boxes/b1/photo")
      .set(headers)
      .field("clientOperationId", op)
      .attach("file", png, {
        filename: "sample.png",
        contentType: "image/png",
      });
    assert.equal(r.status, 200);
    const id = r.body.id;
    const again = await request(app)
      .post("/api/v1/boxes/b1/photo")
      .set(headers)
      .field("clientOperationId", op)
      .attach("file", png, {
        filename: "sample.png",
        contentType: "image/png",
      });
    assert.equal(again.body.id, id);
    r = await request(app).get("/api/v1/documents/" + id + "/file");
    assert.equal(r.status, 401);
    r = await request(app)
      .get("/api/v1/documents/" + id + "/file")
      .set({ cookie: headers.cookie });
    assert.equal(r.status, 200);
    assert.equal(
      createHash("sha256").update(r.body).digest("hex"),
      createHash("sha256").update(png).digest("hex"),
    );
    r = await request(app)
      .get("/api/v1/documents/" + id + "/file")
      .set({ cookie: (await httpSession(app, "demo-driver")).cookie });
    assert.equal(r.status, 403);
    r = await request(app)
      .post("/api/v1/boxes/b1/photo")
      .set(headers)
      .field("clientOperationId", uuid())
      .attach("file", Buffer.alloc(8 * 1024 * 1024 + 1), {
        filename: "big.png",
        contentType: "image/png",
      });
    assert.equal(r.status, 413);
    const failing = createApp(db, { demo: true, uploads: "/dev/null/private" });
    const hf = await httpSession(failing);
    const before = await owned(db, "boxes", "b1", admin);
    r = await request(failing)
      .post("/api/v1/boxes/b1/photo")
      .set(hf)
      .field("clientOperationId", uuid())
      .attach("file", png, {
        filename: "sample.png",
        contentType: "image/png",
      });
    assert.equal(r.status, 500);
    assert.equal(
      (await owned(db, "boxes", "b1", admin)).version,
      before.version,
    );
    await db.query(
      "INSERT INTO organizations VALUES('foreign-org','Foreign test organization',true)",
    );
    await db.query(
      "INSERT INTO documents(id,org_id,name,storage_key,mime,sha256,size) VALUES('foreign-doc','foreign-org','foreign.png',$1,'image/png',$2,$3)",
      [uuid(), createHash("sha256").update(png).digest("hex"), png.length],
    );
    r = await request(app)
      .get("/api/v1/documents/foreign-doc/file")
      .set({ cookie: headers.cookie });
    assert.equal(r.status, 404);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
test("checked order amendment forces reconciliation and blocks stale loading", async () => {
  let a = p({
    customerId: "c3",
    locationId: "l3",
    sourceLabel: "Amendment test",
    condition: "good",
    contents: [
      { productId: "p1", quantity: "3", unit: "piece", verified: true },
    ],
  });
  const b = await call("amend-box", a, (t) => services.receipt(t, admin, a));
  a = p({
    customerId: "c3",
    destinationId: "d3",
    lines: [{ productId: "p1", quantity: "3", unit: "piece" }],
  });
  let o = await call("amend-order", a, (t) => services.order(t, admin, a));
  const line = (
    await db.query("SELECT * FROM order_lines WHERE order_id=$1", [o.id])
  ).rows[0];
  a = p({
    expectedVersion: o.version,
    boxId: b.id,
    orderLineId: line.id,
    quantity: "3",
  });
  o = await call("amend-allocate", a, (t) =>
    services.allocate(t, admin, o.id, a),
  );
  a = p({ businessDate: "2026-11-11", orderIds: [o.id] });
  const prep = await call("amend-prep", a, (t) =>
    services.preparation(t, admin, a),
  );
  for (const stage of ["picking", "packing", "checking", "ready"]) {
    o = await owned(db, "orders", o.id, admin);
    a = p({ expectedVersion: o.version, stage, stagingLocationId: "l3" });
    o = await call("amend-stage:" + stage, a, (t) =>
      services.advance(t, admin, prep.id, o.id, a),
    );
  }
  const app = createApp(db, { demo: true }),
    headers = await httpSession(app);
  let r = await inject(app, {
    method: "POST",
    url: "/api/v1/orders/" + o.id + "/amend",
    headers,
    body: p({
      expectedVersion: o.version,
      orderLineId: line.id,
      quantity: "4",
      reason: "Customer increased requested quantity",
    }),
  });
  assert.equal(r.status, 200);
  const sh = (
    await db.query("SELECT * FROM shipments WHERE order_id=$1", [o.id])
  ).rows[0];
  assert.equal(sh.status, "needs_recheck");
  const po = (
    await db.query("SELECT * FROM preparation_orders WHERE order_id=$1", [o.id])
  ).rows[0];
  assert.equal(po.stage, "checking");
  assert.equal(po.checked, false);
  const load = p({ expectedVersion: sh.version, boxId: b.id });
  await assert.rejects(
    call("amend-block-load", load, (t) => services.load(t, admin, sh.id, load)),
    (e: any) => e.code === "SHIPMENT_STATE",
  );
});
test("preparation add/remove and carry preserve audit without repeating orders", async () => {
  const app = createApp(db, { demo: true }),
    headers = await httpSession(app);
  let a = p({
    customerId: "c2",
    destinationId: "d2",
    lines: [{ productId: "p3", quantity: "2", unit: "piece" }],
  });
  const o = await call("batch-extra-order", a, (t) =>
    services.order(t, admin, a),
  );
  let prep = await owned(db, "preparations", "prep1", admin);
  const count = (await db.query("SELECT count(*)::int n FROM orders")).rows[0]
    .n;
  let r = await inject(app, {
    method: "POST",
    url: "/api/v1/preparation-batches/prep1/add-orders",
    headers,
    body: p({ expectedVersion: prep.version, orderIds: [o.id] }),
  });
  assert.equal(r.status, 200);
  prep = r.body;
  r = await inject(app, {
    method: "POST",
    url: "/api/v1/preparation-batches/prep1/remove-order",
    headers,
    body: p({
      expectedVersion: prep.version,
      orderId: o.id,
      reason: "Moved out of this preparation plan",
    }),
  });
  assert.equal(r.status, 200);
  prep = r.body;
  r = await inject(app, {
    method: "POST",
    url: "/api/v1/preparation-batches/prep1/carry",
    headers,
    body: p({
      expectedVersion: prep.version,
      businessDate: "2026-11-04",
      reason: "Carry unfinished work forward",
    }),
  });
  assert.equal(r.status, 200);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM orders")).rows[0].n,
    count,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM preparation_orders WHERE order_id=$1",
        [o.id],
      )
    ).rows[0].n,
    0,
  );
});
test("authorized partial dispatch creates an outstanding unassigned shipment", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const a = p({
      customerId: "c3",
      locationId: "l3",
      sourceLabel: "Partial dispatch test",
      condition: "good",
      contents: [
        { productId: "p1", quantity: "5", unit: "piece", verified: true },
      ],
    });
    ids.push(
      (await call("partial-box:" + i, a, (t) => services.receipt(t, admin, a)))
        .id,
    );
  }
  let a = p({
    customerId: "c3",
    destinationId: "d3",
    lines: [{ productId: "p1", quantity: "10", unit: "piece" }],
  });
  let o = await call("partial-order", a, (t) => services.order(t, admin, a));
  const line = (
    await db.query("SELECT * FROM order_lines WHERE order_id=$1", [o.id])
  ).rows[0];
  for (const boxId of ids) {
    a = p({
      expectedVersion: o.version,
      boxId,
      orderLineId: line.id,
      quantity: "5",
    });
    o = await call("partial-allocate:" + boxId, a, (t) =>
      services.allocate(t, admin, o.id, a),
    );
  }
  a = p({ businessDate: "2026-11-11", orderIds: [o.id] });
  const prep = await call("partial-prep", a, (t) =>
    services.preparation(t, admin, a),
  );
  for (const stage of ["picking", "packing", "checking", "ready"]) {
    a = p({ expectedVersion: o.version, stage, stagingLocationId: "l3" });
    o = await call("partial-stage:" + stage, a, (t) =>
      services.advance(t, admin, prep.id, o.id, a),
    );
  }
  let sh = (await db.query("SELECT * FROM shipments WHERE order_id=$1", [o.id]))
    .rows[0];
  a = p({
    businessDate: "2026-11-13",
    driverId: "demo-driver",
    vehicle: "DEMO-PARTIAL",
    shipmentIds: [sh.id],
  });
  await call("partial-trip", a, (t) => services.trip(t, admin, a));
  sh = await owned(db, "shipments", sh.id, admin);
  a = p({ expectedVersion: sh.version, boxId: ids[0] });
  sh = await call("partial-load", a, (t) => services.load(t, admin, sh.id, a));
  a = p({
    expectedVersion: sh.version,
    partialApproved: true,
    reason: "Supervisor approved the remaining box for a later trip",
  });
  const dispatched = await call("partial-dispatch", a, (t) =>
    services.dispatch(t, admin, sh.id, a),
  );
  assert.equal(dispatched.status, "dispatched");
  const outstanding = (
    await db.query("SELECT * FROM shipments WHERE order_id=$1 AND id<>$2", [
      o.id,
      sh.id,
    ])
  ).rows[0];
  assert.equal(outstanding.status, "ready");
  assert.equal(outstanding.trip_id, null);
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT sum(quantity) total FROM shipment_lines WHERE shipment_id IN ($1,$2)",
          [sh.id, outstanding.id],
        )
      ).rows[0].total,
    ),
    10,
  );
  assert.equal((await owned(db, "boxes", ids[1], admin)).status, "confirmed");
});
test("cross-customer destination requires an explicit authorization", async () => {
  const payload = p({
    customerId: "c3",
    destinationId: "d2",
    lines: [{ productId: "p1", quantity: "2", unit: "piece" }],
  });
  await assert.rejects(
    call("cross-customer-order", payload, (t) =>
      services.order(t, admin, payload),
    ),
    (e: any) => e.code === "DESTINATION_AUTHORIZATION",
  );
  const app = createApp(db, { demo: true }),
    headers = await httpSession(app);
  let r = await inject(app, {
    method: "POST",
    url: "/api/v1/destination-authorizations",
    headers,
    body: p({
      customerId: "c3",
      destinationId: "d2",
      reason: "Verified synthetic intermediary receiving relationship",
    }),
  });
  assert.equal(r.status, 200);
  r = await inject(app, {
    method: "POST",
    url: "/api/v1/orders",
    headers,
    body: payload,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.destination_id, "d2");
});
test("operational text and status combinations meet WCAG normal-text contrast", () => {
  const luminance = (hex: string) => {
    const rgb = hex
      .replace("#", "")
      .match(/../g)!
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const [fg, bg] of [
    ["#14283B", "#FFFFFF"],
    ["#536575", "#FFFFFF"],
    ["#FFFFFF", "#087A55"],
    ["#b0f5d7", "#1f4c4c"],
    ["#875b10", "#fff5e2"],
    ["#24613e", "#eaf6ef"],
  ]) {
    const a = luminance(fg),
      b = luminance(bg);
    assert.ok(
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5,
      fg + " on " + bg,
    );
  }
});

// Audit regressions use explicitly synthetic addresses and measurements.
async function readyFixture(options: { load?: boolean; trip?: boolean } = {}) {
  const destinationId = uuid();
  await db.query(
    "INSERT INTO destinations(id,org_id,customer_id,name,address,verified) VALUES($1,$2,$3,$4,$5,true)",
    [
      destinationId,
      "demo",
      "c3",
      "Synthetic audit recipient",
      "Synthetic test address · no real destination",
    ],
  );
  let a = p({
    customerId: "c3",
    locationId: "l3",
    sourceLabel: "AUDIT-002 synthetic receipt",
    condition: "good",
    contents: [
      { productId: "p1", quantity: "5", unit: "piece", verified: true },
    ],
  });
  const b = await call("audit.receipt", a, (t) =>
    services.receipt(t, admin, a),
  );
  a = p({
    customerId: "c3",
    destinationId,
    lines: [{ productId: "p1", quantity: "5", unit: "piece" }],
  });
  let o = await call("audit.order", a, (t) => services.order(t, admin, a));
  const ol = (
    await db.query("SELECT * FROM order_lines WHERE order_id=$1", [o.id])
  ).rows[0];
  a = p({
    expectedVersion: o.version,
    boxId: b.id,
    orderLineId: ol.id,
    quantity: "5",
  });
  o = await call("audit.allocate", a, (t) =>
    services.allocate(t, admin, o.id, a),
  );
  a = p({ businessDate: "2026-11-18", orderIds: [o.id] });
  const prep = await call("audit.prep", a, (t) =>
    services.preparation(t, admin, a),
  );
  for (const stage of ["picking", "packing", "checking", "ready"]) {
    a = p({ expectedVersion: o.version, stage, stagingLocationId: "l3" });
    o = await call("audit.stage", a, (t) =>
      services.advance(t, admin, prep.id, o.id, a),
    );
  }
  let shipment = (
    await db.query("SELECT * FROM shipments WHERE order_id=$1", [o.id])
  ).rows[0];
  let journey: any = null;
  if (options.trip !== false) {
    a = p({
      businessDate: "2026-11-20",
      driverId: "demo-driver",
      vehicle: "SYNTHETIC-AUDIT",
      shipmentIds: [shipment.id],
    });
    journey = await call("audit.trip", a, (t) => services.trip(t, admin, a));
    shipment = await owned(db, "shipments", shipment.id, admin);
  }
  if (options.load !== false) {
    a = p({ expectedVersion: shipment.version, boxId: b.id });
    shipment = await call("audit.load", a, (t) =>
      services.load(t, admin, shipment.id, a),
    );
  }
  return {
    box: b,
    order: o,
    orderLine: ol,
    prep,
    shipment,
    trip: journey,
    destinationId,
  };
}

test("audit: repeated physical load with a different operation ID is a visible no-op", async () => {
  const f = await readyFixture();
  const count = (
    await db.query(
      "SELECT count(*)::int n FROM inventory_events WHERE entity_id=$1 AND kind='shipment.box_loaded'",
      [f.shipment.id],
    )
  ).rows[0].n;
  const a = p({ expectedVersion: f.shipment.version, boxId: f.box.id });
  const result = await call("audit.duplicate-load", a, (t) =>
    services.load(t, admin, f.shipment.id, a),
  );
  assert.equal(result.duplicate, true);
  assert.equal(result.version, f.shipment.version);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM inventory_events WHERE entity_id=$1 AND kind='shipment.box_loaded'",
        [f.shipment.id],
      )
    ).rows[0].n,
    count,
  );
});

test("audit: reporting an issue after checking invalidates readiness and loaded marks", async () => {
  const f = await readyFixture();
  const app = createApp(db, { demo: true });
  const r = await inject(app, {
    method: "POST",
    url: "/api/v1/review-issues",
    headers: await httpSession(app, "demo-operator"),
    body: p({
      boxId: f.box.id,
      kind: "damage",
      note: "Synthetic damage found after checking",
    }),
  });
  assert.equal(r.status, 200);
  const sh = await owned(db, "shipments", f.shipment.id, admin);
  assert.equal(sh.status, "needs_recheck");
  assert.equal(
    (
      await db.query("SELECT loaded FROM shipment_lines WHERE shipment_id=$1", [
        sh.id,
      ])
    ).rows[0].loaded,
    false,
  );
  assert.equal(
    (
      await db.query(
        "SELECT checked FROM preparation_orders WHERE order_id=$1",
        [f.order.id],
      )
    ).rows[0].checked,
    false,
  );
  const a = p({ expectedVersion: sh.version });
  await assert.rejects(
    call("audit.issue-dispatch", a, (t) =>
      services.dispatch(t, admin, sh.id, a),
    ),
    (e: any) => e.code === "SHIPMENT_STATE",
  );
});

test("audit: dispatch rechecks open issues even if checking metadata was unchanged", async () => {
  const f = await readyFixture();
  await db.query(
    "INSERT INTO issues(id,org_id,box_id,kind,note) VALUES($1,$2,$3,$4,$5)",
    [uuid(), "demo", f.box.id, "damage", "Synthetic direct regression fixture"],
  );
  const a = p({ expectedVersion: f.shipment.version });
  await assert.rejects(
    call("audit.dispatch-revalidate", a, (t) =>
      services.dispatch(t, admin, f.shipment.id, a),
    ),
    (e: any) => e.code === "OPEN_ISSUE",
  );
  assert.equal((await owned(db, "boxes", f.box.id, admin)).status, "confirmed");
});

test("audit: unverified address blocks ordinary dispatch; supervisor exception requires reason and audit", async () => {
  const f = await readyFixture();
  await db.query(
    "UPDATE destinations SET verified=false,address=NULL WHERE id=$1",
    [f.destinationId],
  );
  let a = p({ expectedVersion: f.shipment.version });
  await assert.rejects(
    call("audit.address-block", a, (t) =>
      services.dispatch(t, admin, f.shipment.id, a),
    ),
    (e: any) => e.code === "ADDRESS_UNVERIFIED",
  );
  const dispatcher = { ...admin, role: "dispatcher" };
  a = p({
    expectedVersion: f.shipment.version,
    addressOverride: true,
    addressOverrideReason: "Requested exception",
  });
  await assert.rejects(
    command(db, dispatcher, "audit.address-denied", a, (t) =>
      services.dispatch(t, dispatcher, f.shipment.id, a),
    ),
    (e: any) => e.status === 403,
  );
  a = p({ expectedVersion: f.shipment.version, addressOverride: true });
  await assert.rejects(
    call("audit.address-reason", a, (t) =>
      services.dispatch(t, admin, f.shipment.id, a),
    ),
    (e: any) => e.code === "REASON_REQUIRED",
  );
  const app = createApp(db, { demo: true });
  const r = await inject(app, {
    method: "POST",
    url: "/api/v1/shipments/" + f.shipment.id + "/dispatch",
    headers: await httpSession(app),
    body: p({
      expectedVersion: f.shipment.version,
      addressOverride: true,
      addressOverrideReason:
        "Synthetic supervisor exception · handover arranged",
    }),
  });
  assert.equal(r.status, 200);
  const e = (
    await db.query(
      "SELECT data FROM inventory_events WHERE entity_id=$1 AND kind='shipment.dispatched'",
      [f.shipment.id],
    )
  ).rows[0];
  assert.equal(e.data.recipient.verified, false);
  assert.equal(e.data.addressException.actorId, admin.id);
  assert.match(e.data.addressException.reason, /Synthetic/);
});

test("audit: reassigned driver cannot receive stale-version state or replay an old handover", async () => {
  const f = await readyFixture();
  let a = p({ expectedVersion: f.shipment.version });
  const sh = await call("audit.driver-dispatch", a, (t) =>
    services.dispatch(t, admin, f.shipment.id, a),
  );
  const line = (
    await db.query("SELECT * FROM shipment_lines WHERE shipment_id=$1", [sh.id])
  ).rows[0];
  const app = createApp(db, { demo: true }),
    driverHeaders = await httpSession(app, "demo-driver");
  const body = p({
    expectedVersion: sh.version,
    lines: [{ lineId: line.id, delivered: "1", returned: "0" }],
    note: "Synthetic partial handover",
  });
  let r = await inject(app, {
    method: "POST",
    url: "/api/v1/shipments/" + sh.id + "/handover",
    headers: driverHeaders,
    body,
  });
  assert.equal(r.status, 200);
  const newDriver = uuid();
  await db.query(
    "INSERT INTO users(id,org_id,email,name,role) VALUES($1,$2,$3,$4,$5)",
    [
      newDriver,
      "demo",
      newDriver + "@example.invalid",
      "Synthetic second driver",
      "driver",
    ],
  );
  await db.query(
    "UPDATE trips SET driver_id=$1,version=version+1 WHERE id=$2",
    [newDriver, f.trip.id],
  );
  r = await inject(app, {
    method: "POST",
    url: "/api/v1/shipments/" + sh.id + "/handover",
    headers: driverHeaders,
    body,
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.details, undefined);
  const wrong = { ...admin, id: "demo-driver", role: "driver" };
  a = p({ ...body, expectedVersion: 999 });
  await assert.rejects(
    command(db, wrong, "audit.driver-stale", a, (t) =>
      services.handover(t, wrong, sh.id, a),
    ),
    (e: any) => e.status === 403 && e.details === undefined,
  );
});

let looseSource: any;
test("audit: repeated loose picks conserve quantity and reuse one picking container", async () => {
  let a = p({
    customerId: null,
    locationId: "l1",
    sourceLabel: "Synthetic loose-pick source",
    condition: "good",
    contents: [
      { productId: "p1", quantity: "10", unit: "piece", verified: true },
    ],
  });
  looseSource = await call("audit.loose-receipt", a, (t) =>
    services.receipt(t, admin, a),
  );
  a = p({
    customerId: "c3",
    destinationId: "d3",
    lines: [{ productId: "p1", quantity: "5", unit: "piece" }],
  });
  let o = await call("audit.loose-order", a, (t) =>
    services.order(t, admin, a),
  );
  const line = (
    await db.query("SELECT * FROM order_lines WHERE order_id=$1", [o.id])
  ).rows[0];
  a = p({ businessDate: "2026-11-18", orderIds: [o.id] });
  const prep = await call("audit.loose-prep", a, (t) =>
    services.preparation(t, admin, a),
  );
  a = p({ expectedVersion: o.version, stage: "picking" });
  o = await call("audit.loose-stage", a, (t) =>
    services.advance(t, admin, prep.id, o.id, a),
  );
  const first = p({
    expectedVersion: o.version,
    sourceBoxId: looseSource.id,
    sourceVersion: looseSource.version,
    contentsId: looseSource.contents[0].id,
    orderLineId: line.id,
    quantity: "2",
    locationId: "l3",
    reason: "Physically picked two sample pieces",
  });
  const one = await call("audit.loose-pick", first, (t) =>
    services.loosePick(t, admin, o.id, first),
  );
  const replay = await call("audit.loose-pick", first, (t) =>
    services.loosePick(t, admin, o.id, first),
  );
  assert.equal(one.target.id, replay.target.id);
  assert.equal(Number(one.source.contents[0].quantity), 8);
  a = p({
    ...first,
    clientOperationId: uuid(),
    expectedVersion: one.order.version,
    sourceVersion: one.source.version,
    targetBoxId: one.target.id,
    targetVersion: one.target.version,
    quantity: "3",
  });
  const two = await call("audit.loose-pick", a, (t) =>
    services.loosePick(t, admin, o.id, a),
  );
  assert.equal(two.target.id, one.target.id);
  assert.equal(Number(two.source.contents[0].quantity), 5);
  assert.equal(Number(two.target.contents[0].quantity), 5);
  const allocation = (
    await db.query("SELECT * FROM allocations WHERE order_id=$1", [o.id])
  ).rows[0];
  assert.equal(Number(allocation.picked_quantity), 5);
  assert.equal(allocation.box_id, two.target.id);
  assert.notEqual(allocation.box_id, looseSource.id);
  assert.equal(
    quantitySum([
      two.source.contents[0].quantity,
      two.target.contents[0].quantity,
    ]).confirmed,
    "10",
  );
  const before = two.source.contents[0].quantity;
  a = p({
    ...first,
    clientOperationId: uuid(),
    expectedVersion: two.order.version,
    sourceVersion: two.source.version,
    quantity: "99",
  });
  await assert.rejects(
    call("audit.loose-overpick", a, (t) =>
      services.loosePick(t, admin, o.id, a),
    ),
    (e: any) => e.code === "INSUFFICIENT_STOCK",
  );
  assert.equal(
    (await boxState(db, admin, looseSource.id)).contents[0].quantity,
    before,
  );
});

test("audit: fully picking a source records known empty rather than unknown stock", async () => {
  const src = await boxState(db, admin, looseSource.id);
  let a = p({
    customerId: "c3",
    destinationId: "d3",
    lines: [{ productId: "p1", quantity: "5", unit: "piece" }],
  });
  let o = await call("audit.empty-order", a, (t) =>
    services.order(t, admin, a),
  );
  const line = (
    await db.query("SELECT * FROM order_lines WHERE order_id=$1", [o.id])
  ).rows[0];
  a = p({ businessDate: "2026-11-18", orderIds: [o.id] });
  const prep = await call("audit.empty-prep", a, (t) =>
    services.preparation(t, admin, a),
  );
  a = p({ expectedVersion: o.version, stage: "picking" });
  o = await call("audit.empty-stage", a, (t) =>
    services.advance(t, admin, prep.id, o.id, a),
  );
  a = p({
    expectedVersion: o.version,
    sourceBoxId: src.id,
    sourceVersion: src.version,
    contentsId: src.contents[0].id,
    orderLineId: line.id,
    quantity: "5",
    locationId: "l3",
    reason: "Physically emptied source into order container",
  });
  const result = await call("audit.empty-pick", a, (t) =>
    services.loosePick(t, admin, o.id, a),
  );
  assert.equal(result.source.status, "empty");
  assert.equal(result.source.contents.length, 0);
  assert.equal(Number(result.target.contents[0].quantity), 5);
});

test("audit: configured food tracking keeps missing data unconfirmed and validates measured values", async () => {
  const productId = uuid();
  await db.query(
    "INSERT INTO products(id,org_id,sku,name,profile,unit) VALUES($1,$2,$3,$4,$5,$6)",
    [
      productId,
      "demo",
      "TEST-" + productId,
      "Synthetic food item",
      "Chilled",
      "kg",
    ],
  );
  const app = createApp(db, { demo: true });
  let r = await inject(app, {
    method: "POST",
    url: "/api/v1/products/" + productId + "/traceability",
    headers: await httpSession(app, "demo-operator"),
    body: p({
      expectedVersion: 1,
      requireLot: true,
      requireExpiry: true,
      requireTemperature: true,
      temperatureMin: "2",
      temperatureMax: "8",
      reason: "Synthetic regression rule · not a real product requirement",
    }),
  });
  assert.equal(r.status, 403);
  r = await inject(app, {
    method: "POST",
    url: "/api/v1/products/" + productId + "/traceability",
    headers: await httpSession(app),
    body: p({
      expectedVersion: 1,
      requireLot: true,
      requireExpiry: true,
      requireTemperature: true,
      temperatureMin: "2",
      temperatureMax: "8",
      reason: "Synthetic regression rule · not a real product requirement",
    }),
  });
  assert.equal(r.status, 200);
  let a = p({
    customerId: "c1",
    locationId: "l1",
    sourceLabel: "Synthetic traceability receipt",
    condition: "good",
    contents: [{ productId, quantity: "10", unit: "kg", verified: true }],
  });
  let b = await call("audit.trace-receipt", a, (t) =>
    services.receipt(t, admin, a),
  );
  assert.equal(b.status, "unconfirmed");
  assert.ok(b.traceabilityProblems.length >= 3);
  const lot = uuid();
  await db.query(
    "INSERT INTO lots(id,org_id,product_id,reference,expires_on) VALUES($1,$2,$3,$4,$5)",
    [lot, "demo", productId, "SYNTHETIC-LOT", "2030-01-01"],
  );
  a = p({
    expectedVersion: b.version,
    reason: "Recorded synthetic batch and actual test measurement",
    contents: [
      {
        productId,
        quantity: "10",
        unit: "kg",
        lotId: lot,
        temperatureC: "-10",
        verified: true,
      },
    ],
  });
  b = await call("audit.trace-bad-temp", a, (t) =>
    services.confirm(t, admin, b.id, a),
  );
  assert.equal(b.status, "unconfirmed");
  assert.match(b.traceabilityProblems.join(" "), /outside/);
  a = p({
    expectedVersion: b.version,
    reason: "Verified synthetic measurement",
    contents: [
      {
        productId,
        quantity: "10",
        unit: "kg",
        lotId: lot,
        temperatureC: "5",
        verified: true,
      },
    ],
  });
  b = await call("audit.trace-good", a, (t) =>
    services.confirm(t, admin, b.id, a),
  );
  assert.equal(b.status, "confirmed");
  assert.equal(b.traceabilityProblems.length, 0);
  assert.equal(Number(b.contents[0].temperature_c), 5);
  assert.equal(b.contents[0].lot_id, lot);
});

test("audit: verified quantity correction requires authority, reason and previous-value evidence", async () => {
  let a = p({
    customerId: null,
    locationId: "l1",
    sourceLabel: "Synthetic correction fixture",
    condition: "good",
    contents: [
      { productId: "p1", quantity: "10", unit: "piece", verified: true },
    ],
  });
  const b = await call("audit.correction-receipt", a, (t) =>
    services.receipt(t, admin, a),
  );
  const operator = { ...admin, id: "demo-operator", role: "operator" };
  a = p({
    expectedVersion: b.version,
    contents: [
      { productId: "p1", quantity: "9", unit: "piece", verified: true },
    ],
  });
  await assert.rejects(
    command(db, operator, "audit.operator-correction", a, (t) =>
      services.confirm(t, operator, b.id, a),
    ),
    (e: any) => e.status === 403,
  );
  await assert.rejects(
    call("audit.correction-no-reason", a, (t) =>
      services.confirm(t, admin, b.id, a),
    ),
    (e: any) => e.code === "CORRECTION_REASON",
  );
  a = p({ ...a, reason: "Physical recount confirmed nine sample pieces" });
  const result = await call("audit.correction-reason", a, (t) =>
    services.confirm(t, admin, b.id, a),
  );
  assert.equal(Number(result.contents[0].quantity), 9);
  const ev = (
    await db.query(
      "SELECT data FROM inventory_events WHERE entity_id=$1 AND kind='box.contents_confirmed'",
      [b.id],
    )
  ).rows[0];
  assert.equal(Number(ev.data.previousContents[0].quantity), 10);
  assert.match(ev.data.reason, /recount/);
});

test("audit: trip stop sequence follows explicit shipment selection order", async () => {
  const a = await readyFixture({ trip: false, load: false }),
    b = await readyFixture({ trip: false, load: false });
  const shipments = [a.shipment, b.shipment].sort((x, y) =>
    y.id.localeCompare(x.id),
  );
  const body = p({
    businessDate: "2026-11-20",
    driverId: "demo-driver",
    vehicle: "SYNTHETIC-ORDERED",
    shipmentIds: shipments.map((s) => s.id),
  });
  const tr = await call("audit.stop-sequence", body, (t) =>
    services.trip(t, admin, body),
  );
  const stops = (
    await db.query("SELECT * FROM stops WHERE trip_id=$1 ORDER BY position", [
      tr.id,
    ])
  ).rows;
  assert.deepEqual(
    stops.map((s) => s.destination_id),
    shipments.map((s) => s.destination_id),
  );
});
test("audit: verified destination address requires authorized evidence and retains version/history", async () => {
  const app = createApp(db, { demo: true });
  const d = await owned(db, "destinations", "d1", admin);
  const body = p({
    expectedVersion: d.version,
    address: "Synthetic verified QA address · no real destination",
    reason: "Synthetic address verification evidence",
  });
  let r = await inject(app, {
    method: "POST",
    url: "/api/v1/destinations/d1/verify-address",
    headers: await httpSession(app, "demo-operator"),
    body,
  });
  assert.equal(r.status, 403);
  r = await inject(app, {
    method: "POST",
    url: "/api/v1/destinations/d1/verify-address",
    headers: await httpSession(app),
    body,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.verified, true);
  assert.equal(r.body.version, d.version + 1);
  assert.ok(
    (
      await db.query(
        "SELECT id FROM inventory_events WHERE entity_id='d1' AND kind='destination.address_verified'",
      )
    ).rows.length,
  );
});
test("audit: a physical box can be received before any product is identified", async () => {
  const app = createApp(db, { demo: true }),
    headers = await httpSession(app);
  const payload = p({
    customerId: null,
    locationId: "l1",
    sourceLabel: "Uninterpreted synthetic label · contents genuinely unknown",
    condition: "good",
    contents: [],
  });
  const r = await inject(app, {
    method: "POST",
    url: "/api/v1/receipts",
    headers,
    body: payload,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "unconfirmed");
  assert.equal(r.body.contents.length, 0);
  const repeated = await inject(app, {
    method: "POST",
    url: "/api/v1/receipts",
    headers,
    body: payload,
  });
  assert.equal(repeated.body.id, r.body.id);
  assert.notEqual(r.body.status, "empty");
  assert.ok(r.body.code.startsWith("BOX-"));
});

test("platform: database constraints reject cross-company links including preparation and jobs", async () => {
  const org = "isolation-" + uuid(), loc = uuid(), customer = uuid(), user = uuid(), prep = uuid();
  await db.query("INSERT INTO organizations VALUES($1,'Synthetic isolation company',true)", [org]);
  await db.query("INSERT INTO users(id,org_id,email,name,role) VALUES($1,$2,$3,'Other company administrator','administrator')", [user,org,user+'@example.invalid']);
  await db.query("INSERT INTO locations(id,org_id,code,name,kind) VALUES($1,$2,'0001','Other location','floor')", [loc,org]);
  await db.query("INSERT INTO customers(id,org_id,code,name) VALUES($1,$2,'0001','Other customer')", [customer,org]);
  await db.query("INSERT INTO preparations(id,org_id,business_date) VALUES($1,$2,'2026-10-30')", [prep,org]);
  const rejected = [
    ["INSERT INTO boxes(id,org_id,code,location_id) VALUES($1,'demo',$1,$2)", [uuid(),loc]],
    ["INSERT INTO destinations(id,org_id,customer_id,name) VALUES($1,'demo',$2,'Wrong company')", [uuid(),customer]],
    ["INSERT INTO documents(id,org_id,box_id,name,storage_key,mime,sha256,size) VALUES($1,$2,'b1','foreign', $1,'image/png','no',1)", [uuid(),org]],
    ["INSERT INTO jobs(id,org_id,actor_id,kind) VALUES($1,'demo',$2,'inventory-export')", [uuid(),user]],
    ["INSERT INTO preparation_orders(preparation_id,order_id) VALUES($1,'o1')", [prep]],
  ] as [string,any[]][];
  for (const [sql,params] of rejected) await assert.rejects(db.query(sql,params), (e:any)=>e.code === '23503');
  const ownPrep=uuid(), ownOrder=uuid();
  await db.query("INSERT INTO preparations(id,org_id,business_date) VALUES($1,'demo','2026-10-28')",[ownPrep]);
  await db.query("INSERT INTO orders(id,org_id,code,customer_id,destination_id) VALUES($1,'demo',$1,'c3','d3')",[ownOrder]);
  await db.query("INSERT INTO preparation_orders(preparation_id,order_id) VALUES($1,$2)",[ownPrep,ownOrder]);
  assert.equal((await db.query("SELECT org_id FROM preparation_orders WHERE order_id=$1",[ownOrder])).rows[0].org_id,'demo');
});

test("platform: export download and workspace results require export permission", async () => {
  const app=createApp(db,{demo:true}), adminHeaders=await httpSession(app);
  const job=(await inject(app,{method:'POST',url:'/api/v1/jobs',headers:adminHeaders,body:p({kind:'inventory-export'})})).body;
  await db.query("UPDATE jobs SET status='completed',result=$1 WHERE id=$2", [JSON.stringify({privateExport:'synthetic'}),job.id]);
  const operator=await httpSession(app,'demo-operator');
  assert.equal((await inject(app,{url:'/api/v1/jobs/'+job.id+'/result',headers:operator})).status,403);
  const workspace=await inject(app,{url:'/api/v1/workspace',headers:operator});
  assert.deepEqual(workspace.body.jobs,[]);
  assert.equal((await inject(app,{url:'/api/v1/jobs/'+job.id+'/result',headers:adminHeaders})).status,200);
});

test("platform: worker rejects revoked actors and unsupported job kinds", async () => {
  const id=uuid(), user=uuid();
  await db.query("INSERT INTO users(id,org_id,email,name,role) VALUES($1,'demo',$2,'Revoked export actor','reviewer')", [user,user+'@example.invalid']);
  await db.query("INSERT INTO jobs(id,org_id,actor_id,kind) VALUES($1,'demo',$2,'inventory-export')", [id,user]);
  for(let i=0;i<3;i++) { await db.query("UPDATE jobs SET available_at=now() WHERE id=$1",[id]); await workOnce(db); }
  const job=(await db.query('SELECT * FROM jobs WHERE id=$1',[id])).rows[0];
  assert.equal(job.status,'failed'); assert.equal(job.result,null); assert.equal(job.attempts,3);
  const unsupported=uuid();
  await db.query("INSERT INTO jobs(id,org_id,actor_id,kind) VALUES($1,'demo','demo-admin','untrusted-provider')",[unsupported]);
  await workOnce(db);
  assert.equal((await db.query('SELECT result FROM jobs WHERE id=$1',[unsupported])).rows[0].result,null);
});

test("platform: occupied restore does not overwrite files, and corrupted evidence restores no records", async () => {
  const temp=await mkdtemp(path.join(os.tmpdir(),'warehouse-safe-restore-'));
  const target=await openDatabase(null,':memory:');
  try {
    await migrate(target);
    const source=await openDatabase(null,':memory:');
    await migrate(source); await seed(source);
    const key=uuid(), bytes=Buffer.from('private recovery evidence'), files=path.join(temp,'private');
    await mkdir(files); await writeFile(path.join(files,key),bytes);
    await source.query("INSERT INTO documents(id,org_id,box_id,name,storage_key,mime,sha256,size) VALUES($1,'demo','b1','evidence',$1,'image/png',$2,$3)",[key,createHash('sha256').update(bytes).digest('hex'),bytes.length]);
    const filename=path.join(temp,'backup.json'); await writeBackup(source,filename,files);
    const uploads=path.join(temp,'occupied'); await mkdir(uploads); await writeFile(path.join(uploads,key),'existing private bytes');
    await assert.rejects(restoreBackup(target,filename,uploads),/exist/i);
    assert.equal((await readFile(path.join(uploads,key))).toString(),'existing private bytes');
    assert.equal((await target.query('SELECT count(*)::int n FROM organizations')).rows[0].n,0);
    await restoreSnapshot(target,await snapshot(source));
    const untouched=path.join(temp,'not-created');
    await assert.rejects(restoreBackup(target,filename,untouched),/empty/);
    await assert.rejects(readFile(path.join(untouched,key)),/ENOENT/);
    await writeFile(path.join(filename+'.files',key),'corrupt evidence');
    const fresh=await openDatabase(null,':memory:'); await migrate(fresh);
    await assert.rejects(restoreBackup(fresh,filename,path.join(temp,'fresh')),/integrity/);
    assert.equal((await fresh.query('SELECT count(*)::int n FROM organizations')).rows[0].n,0);
    await fresh.close(); await source.close();
  } finally { await target.close(); await rm(temp,{recursive:true,force:true}); }
});

test("platform: incomplete backup is rejected instead of silently dropping records", async () => {
  const target=await openDatabase(null,':memory:');
  try { await migrate(target); await assert.rejects(restoreSnapshot(target,{format:'jadesun-v2',tables:{organizations:[]}}),/Missing backup table/); }
  finally { await target.close(); }
});

test("platform: native race participants use two independent backend connections", {skip: !process.env.TEST_DATABASE_URL}, async () => {
  let release!:()=>void; const gate=new Promise<void>(r=>release=r); let arrived=0;
  const check=(pool:DB)=>pool.transaction(async t=>{
    const pid=(await t.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    if(++arrived===2) release(); await gate; return pid;
  });
  const pids=await Promise.all([check(db),check(raceDB)]); assert.notEqual(pids[0],pids[1]);
});

test("platform: SQL migrations preserve quoted semicolons and comments", async()=>{
  const {splitStatements}=await import('../packages/database/sql.js');
  assert.equal(splitStatements("-- semicolon; in comment\nSELECT ';' AS v; /* nested /* ; */ comment */ SELECT $$body;$$; -- final; comment").length,2);
  assert.equal(splitStatements('SELECT "semi;colon";').length,1);
  assert.throws(()=>splitStatements("SELECT 'unterminated"),/Unterminated/);
});

test("platform: company setup is versioned, resumable, audited and server-authorized", async()=>{
  const app=createApp(db,{demo:true}), headers=await httpSession(app);
  let current=(await inject(app,{url:'/api/v1/workspace',headers})).body.configuration;
  const payload=p({expectedVersion:current.version,section:'identity',displayName:'JadeSun · Synthetic configurable warehouse',operatingProfile:'general',reason:'Synthetic setup verification'});
  let r=await inject(app,{url:'/api/v1/company-configuration',method:'POST',headers,body:payload});
  assert.equal(r.status,200); assert.equal(r.body.identity_reviewed,true); assert.equal(r.body.version,current.version+1);
  const again=await inject(app,{url:'/api/v1/company-configuration',method:'POST',headers,body:payload});
  assert.deepEqual(again.body,r.body);
  const operator=await httpSession(app,'demo-operator');
  assert.equal((await inject(app,{url:'/api/v1/company-configuration',method:'POST',headers:operator,body:{...payload,clientOperationId:uuid()}})).status,403);
  const stale=await inject(app,{url:'/api/v1/company-configuration',method:'POST',headers,body:{...payload,clientOperationId:uuid()}});
  assert.equal(stale.status,409); assert.equal(stale.body.error.details.current.version,r.body.version);
  const bad=await inject(app,{url:'/api/v1/company-configuration',method:'POST',headers,body:p({expectedVersion:r.body.version,section:'locale',timezone:'Invented/Zone',language:'en',dateFormat:'iso',reason:'Invalid timezone'})});
  assert.equal(bad.status,422);
  current=(await inject(app,{url:'/api/v1/workspace',headers})).body.configuration;
  r=await inject(app,{url:'/api/v1/company-configuration',method:'POST',headers,body:p({expectedVersion:current.version,section:'locale',timezone:'Europe/London',language:'en',dateFormat:'day-first',reason:'Confirmed synthetic UK locale'})});
  assert.equal(r.status,200); assert.equal(r.body.identity_reviewed,true);assert.equal(r.body.locale_reviewed,true);
  const history=await inject(app,{url:'/api/v1/company-configuration/history',headers});
  assert.ok(history.body.length>=2);
  await assert.rejects(db.query("UPDATE company_configuration_revisions SET reason='rewrite' WHERE org_id='demo'"),/immutable/i);
});

test("platform: schedules suggest dates, empty batches create no orders, and preserve policy history", async()=>{
  const {nextPreparationDate}=await import('../packages/domain/scheduling.js');
  assert.equal(nextPreparationDate('2026-10-26',[3]),'2026-10-28');
  assert.equal(nextPreparationDate('2026-10-26',[5]),'2026-10-30');
  assert.equal(nextPreparationDate('2026-03-28',[0]),'2026-03-29');
  assert.equal(nextPreparationDate('2026-10-24',[0]),'2026-10-25');
  assert.equal(nextPreparationDate('2026-10-26',[]),null);
  const app=createApp(db,{demo:true}),headers=await httpSession(app);
  let config=(await inject(app,{url:'/api/v1/workspace',headers})).body.configuration;
  const ordersBefore=(await db.query("SELECT count(*)::int n FROM orders WHERE org_id='demo'")).rows[0].n;
  const scheduled=await inject(app,{url:'/api/v1/company-configuration',method:'POST',headers,body:p({expectedVersion:config.version,section:'schedule',preparationWeekdays:[3],reason:'Confirmed JadeSun Wednesday preparation template'})});
  assert.equal(scheduled.status,200);
  const prepared=await inject(app,{url:'/api/v1/preparation-batches',method:'POST',headers,body:p({businessDate:'2026-10-28',orderIds:[]})});
  assert.equal(prepared.status,200);assert.equal(prepared.body.status,undefined);
  assert.deepEqual(prepared.body.policy_snapshot.preparationWeekdays,[3]);
  config=scheduled.body;
  const changed=await inject(app,{url:'/api/v1/company-configuration',method:'POST',headers,body:p({expectedVersion:config.version,section:'schedule',preparationWeekdays:[5],reason:'Synthetic later scheduling change'})});
  assert.equal(changed.status,200);
  const original=await owned(db,'preparations',prepared.body.id,admin);
  assert.deepEqual(original.policy_snapshot.preparationWeekdays,[3]);
  assert.equal(original.configuration_version,config.version);
  assert.equal((await db.query("SELECT count(*)::int n FROM orders WHERE org_id='demo'")).rows[0].n,ordersBefore);
});

test("platform: populated legacy migration preserves IDs/history and rejects ambiguous company membership",async()=>{
  const {splitStatements}=await import('../packages/database/sql.js');
  const {readdir}=await import('node:fs/promises');
  async function legacy(ambiguous:boolean){
    const old=await openDatabase(null,':memory:');
    await old.query('CREATE TABLE migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
    for(const name of (await readdir('packages/database/migrations')).filter(n=>n.endsWith('.sql') && n<'008').sort()){
      for(const sql of splitStatements(await readFile('packages/database/migrations/'+name,'utf8')))await old.query(sql);
      await old.query('INSERT INTO migrations(name) VALUES($1)',[name]);
    }
    await old.query("INSERT INTO organizations VALUES('legacy','Original company',false),('other','Other company',false)");
    await old.query("INSERT INTO users(id,org_id,email,name,role) VALUES('legacy-user','legacy','legacy@example.invalid','Legacy operator','administrator')");
    await old.query("INSERT INTO customers(id,org_id,code,name) VALUES('legacy-c','legacy','0007','原有客户')");
    await old.query("INSERT INTO destinations(id,org_id,customer_id,name) VALUES('legacy-d','legacy','legacy-c','Original recipient')");
    await old.query("INSERT INTO locations(id,org_id,code,name,kind) VALUES('legacy-l','legacy','A-001','Original position','floor')");
    await old.query("INSERT INTO boxes(id,org_id,code,location_id) VALUES('legacy-b','legacy','BOX-000001','legacy-l')");
    await old.query("INSERT INTO orders(id,org_id,code,customer_id,destination_id) VALUES('legacy-o','legacy','ORD-0001','legacy-c','legacy-d')");
    await old.query("INSERT INTO preparations(id,org_id,business_date) VALUES('legacy-p',$1,'2026-10-28')",[ambiguous?'other':'legacy']);
    await old.query("INSERT INTO preparation_orders(preparation_id,order_id) VALUES('legacy-p','legacy-o')");
    await old.query("INSERT INTO inventory_events(id,org_id,actor_id,entity_id,kind,data) VALUES('legacy-event','legacy','legacy-user','legacy-b','original.receipt','{}')");
    return old;
  }
  const good=await legacy(false),bad=await legacy(true);
  try{
    await migrate(good);
    assert.equal((await good.query("SELECT code FROM boxes WHERE id='legacy-b'")).rows[0].code,'BOX-000001');
    assert.equal((await good.query("SELECT org_id FROM preparation_orders WHERE order_id='legacy-o'")).rows[0].org_id,'legacy');
    assert.equal((await good.query("SELECT count(*)::int n FROM inventory_events WHERE id='legacy-event'")).rows[0].n,1);
    const config=(await good.query("SELECT * FROM company_configuration WHERE org_id='legacy'")).rows[0];
    assert.equal(config.timezone,null);assert.deepEqual(config.preparation_weekdays,[]);
    assert.equal((await good.query("SELECT policy_snapshot FROM preparations WHERE id='legacy-p'")).rows[0].policy_snapshot,null);
    await assert.rejects(migrate(bad),/Cross-company preparation membership/);
    assert.equal((await bad.query("SELECT count(*)::int n FROM migrations WHERE name='008_company_integrity.sql'")).rows[0].n,0);
    assert.equal((await bad.query("SELECT count(*)::int n FROM preparation_orders")).rows[0].n,1);
    assert.equal((await bad.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='preparation_orders' AND column_name='org_id'")).rows[0].n,0);
  }finally{await good.close();await bad.close();}
});

test("platform: two authenticated companies cannot read, mutate, search or export each other's records", async()=>{
  const bcrypt=(await import('bcryptjs')).default, org=uuid(), user=uuid(), loc=uuid(), product=uuid(), email=user+'@example.invalid', password=uuid()+uuid();
  await db.query("INSERT INTO organizations VALUES($1,'Other synthetic warehouse',true)",[org]);
  await db.query("INSERT INTO users(id,org_id,email,name,role,password_hash) VALUES($1,$2,$3,'Other company admin','administrator',$4)",[user,org,email,await bcrypt.hash(password,4)]);
  await db.query("INSERT INTO company_configuration(org_id,display_name) VALUES($1,'Other synthetic warehouse')",[org]);
  await db.query("INSERT INTO locations(id,org_id,code,name,kind) VALUES($1,$2,'0001','Other company position','floor')",[loc,org]);
  await db.query("INSERT INTO products(id,org_id,sku,name,profile,unit) VALUES($1,$2,'0001','Private other product','General goods','piece')",[product,org]);
  const app=createApp(db,{demo:true}), boot=await inject(app,{url:'/api/v1/session'});
  const logged=await inject(app,{method:'POST',url:'/api/v1/auth/login',headers:{Cookie:boot.headers['set-cookie'][0].split(';')[0],'X-CSRF-Token':boot.body.csrf},body:{email,password}});
  const cookie=logged.headers['set-cookie'][0].split(';')[0];
  const session=await inject(app,{url:'/api/v1/session',headers:{Cookie:cookie}});
  const bHeaders={Cookie:cookie,'X-CSRF-Token':session.body.csrf}, aHeaders=await httpSession(app);
  assert.equal(session.body.user.org_id,org);
  const received=await inject(app,{method:'POST',url:'/api/v1/receipts',headers:bHeaders,body:p({customerId:null,locationId:loc,contents:[{productId:product,quantity:'2',unit:'piece',verified:true}]})});
  assert.equal(received.status,200);
  assert.equal((await inject(app,{url:'/api/v1/boxes/'+received.body.id,headers:aHeaders})).status,404);
  assert.equal((await inject(app,{method:'POST',url:'/api/v1/boxes/'+received.body.id+'/move',headers:aHeaders,body:p({expectedVersion:1,locationId:'l1',reason:'Forbidden other company move'})})).status,404);
  const workspace=(await inject(app,{url:'/api/v1/workspace?search=0001',headers:aHeaders})).body;
  assert.ok(!workspace.boxes.some((b:any)=>b.id===received.body.id));assert.ok(!workspace.products.some((b:any)=>b.id===product));
  const queued=await inject(app,{method:'POST',url:'/api/v1/jobs',headers:bHeaders,body:p({kind:'inventory-export'})});
  await db.query("UPDATE jobs SET status='completed',result=$1 WHERE id=$2",[JSON.stringify({company:org}),queued.body.id]);
  assert.equal((await inject(app,{url:'/api/v1/jobs/'+queued.body.id+'/result',headers:aHeaders})).status,404);
  const before=(await db.query('SELECT count(*)::int n FROM orders WHERE org_id=$1',[org])).rows[0].n;
  const configured=await inject(app,{method:'POST',url:'/api/v1/company-configuration',headers:bHeaders,body:p({expectedVersion:1,section:'schedule',preparationWeekdays:[5],reason:'Other company uses Friday',org_id:'demo'})});
  assert.equal(configured.status,200);assert.equal(configured.body.org_id,org);assert.deepEqual(configured.body.preparation_weekdays,[5]);
  assert.equal((await db.query('SELECT count(*)::int n FROM orders WHERE org_id=$1',[org])).rows[0].n,before);
  const aConfig=(await inject(app,{url:'/api/v1/workspace',headers:aHeaders})).body.configuration;
  assert.equal(aConfig.org_id,'demo');
});

async function selectContext(app:any, headers:Record<string,string>, companyId:string, warehouseId?:string){
  const switched=await inject(app,{method:'POST',url:'/api/v1/auth/context',headers,body:{companyId,warehouseId}});
  assert.equal(switched.status,200,JSON.stringify(switched.body));
  const cookie=switched.headers['set-cookie'][0].split(';')[0];
  const session=await inject(app,{url:'/api/v1/session',headers:{Cookie:cookie}});
  return {headers:{Cookie:cookie,'X-CSRF-Token':session.body.csrf},session:session.body};
}
let newWarehouse:any,newLocation:any,scopedBox:any,newWarehouseHeaders:Record<string,string>,accessApp:any;
test('access: warehouse creation, explicit switch and receipt use server-derived scope',async()=>{
 accessApp=createApp(db,{demo:true}); const headers=await httpSession(accessApp);
 let r=await inject(accessApp,{method:'POST',url:'/api/v1/warehouses',headers,body:p({code:'SYNTHETIC-SECOND',name:'Synthetic second warehouse',address:null,reason:'Warehouse isolation verification'})});
 assert.equal(r.status,200);newWarehouse=r.body;
 const selected=await selectContext(accessApp,headers,'demo',newWarehouse.id);newWarehouseHeaders=selected.headers;
 assert.equal(selected.session.user.warehouse_id,newWarehouse.id);
 assert.notEqual(selected.headers['X-CSRF-Token'],headers['x-csrf-token']);
 r=await inject(accessApp,{method:'POST',url:'/api/v1/catalogs/locations',headers:newWarehouseHeaders,body:p({record:{code:'RCV-01',name:'Second receiving position',kind:'floor',restrictions:null,warehouse_id:'demo:legacy'}})});
 assert.equal(r.status,200);newLocation=r.body;assert.equal(r.body.warehouse_id,newWarehouse.id);
 const receipt=p({customerId:null,locationId:newLocation.id,sourceLabel:'Synthetic warehouse isolation receipt',contents:[{productId:'p1',quantity:'4',unit:'piece',verified:true}],warehouse_id:'demo:legacy'});
 r=await inject(accessApp,{method:'POST',url:'/api/v1/receipts',headers:newWarehouseHeaders,body:receipt});assert.equal(r.status,200);scopedBox=r.body;
 assert.equal(scopedBox.warehouse_id,newWarehouse.id);assert.equal(scopedBox.contents[0].warehouse_id,newWarehouse.id);
 assert.equal((await inject(accessApp,{method:'POST',url:'/api/v1/receipts',headers:newWarehouseHeaders,body:receipt})).body.id,scopedBox.id);
 const oldScope=await selectContext(accessApp,newWarehouseHeaders,'demo','demo:legacy');
 assert.equal((await inject(accessApp,{method:'POST',url:'/api/v1/receipts',headers:oldScope.headers,body:receipt})).status,409);
});
test('access: warehouse reads, search, files, labels, jobs and relationships are isolated',async()=>{
 const headers=await httpSession(accessApp);
 assert.equal((await inject(accessApp,{url:'/api/v1/boxes/'+scopedBox.id,headers})).status,404);
 assert.equal((await inject(accessApp,{url:'/api/v1/labels/box/'+scopedBox.id,headers})).status,404);
 assert.equal((await inject(accessApp,{method:'POST',url:'/api/v1/boxes/'+scopedBox.id+'/move',headers,body:p({expectedVersion:1,locationId:'l1',reason:'Wrong warehouse move'})})).status,404);
 const workspace=(await inject(accessApp,{url:'/api/v1/workspace?search='+scopedBox.code,headers})).body;
 assert.ok(!workspace.boxes.some((b:any)=>b.id===scopedBox.id));assert.ok(!workspace.locations.some((l:any)=>l.id===newLocation.id));
 await assert.rejects(db.query('UPDATE boxes SET location_id=$1 WHERE id=$2',['l1',scopedBox.id]),(e:any)=>e.code==='23503');
 const a=await selectContext(accessApp,headers,'demo',newWarehouse.id);newWarehouseHeaders=a.headers;
 const document=uuid();await db.query("INSERT INTO documents(id,org_id,box_id,name,storage_key,mime,sha256,size) VALUES($1,'demo',$2,'synthetic.png',$1,'image/png','not-real',1)",[document,scopedBox.id]);
 const legacy=await httpSession(accessApp);
 assert.equal((await inject(accessApp,{url:'/api/v1/documents/'+document+'/file',headers:legacy})).status,404);
 const job=(await inject(accessApp,{method:'POST',url:'/api/v1/jobs',headers:newWarehouseHeaders,body:p({kind:'inventory-export'})})).body;
 // A worker sees only boxes in the job's warehouse.
 for(let i=0;i<8;i++)await workOnce(db);
 const result=await inject(accessApp,{url:'/api/v1/jobs/'+job.id+'/result',headers:newWarehouseHeaders});
 assert.equal(result.status,200);assert.ok(result.body.boxes.some((b:any)=>b.code===scopedBox.code));assert.ok(!result.body.boxes.some((b:any)=>b.code==='BOX-00001'));
 assert.equal((await inject(accessApp,{url:'/api/v1/jobs/'+job.id+'/result',headers:legacy})).status,404);
});
test('access: company membership alone grants no warehouse and revocation blocks cached replay',async()=>{
 const headers=await httpSession(accessApp), email=uuid()+'@example.invalid', user=uuid(), other=uuid();
 await db.query("INSERT INTO organizations VALUES($1,'Synthetic identity home',true)",[other]);
 await db.query("INSERT INTO users(id,org_id,email,name,role) VALUES($1,$2,$3,'Synthetic shared employee','operator')",[user,other,email]);
 const grantBody=p({email,expectedVersion:0,role:'operator',active:true,reason:'Explicit additional company membership'});
 let r=await inject(accessApp,{method:'POST',url:'/api/v1/access/memberships',headers,body:grantBody});assert.equal(r.status,200);assert.equal(r.body.version,1);
 assert.equal((await db.query("SELECT count(*)::int n FROM warehouse_grants WHERE user_id=$1 AND org_id='demo'",[user])).rows[0].n,0);
 assert.equal((await inject(accessApp,{method:'POST',url:'/api/v1/access/memberships',headers,body:grantBody})).body.version,1);
 const warehouseGrant=p({userId:user,warehouseId:newWarehouse.id,expectedVersion:0,active:true,reason:'Explicit warehouse assignment'});
 r=await inject(accessApp,{method:'POST',url:'/api/v1/access/warehouse-grants',headers,body:warehouseGrant});assert.equal(r.status,200);
 const {resolveActor}=await import('../packages/domain/context.js');
 const actor=await resolveActor(db,user,'demo',newWarehouse.id);assert.ok(actor);assert.equal(actor.role,'operator');
 const receipt=p({customerId:null,locationId:newLocation.id,sourceLabel:'Revocation replay fixture',condition:'good',contents:[]});
 const created=await command(db,actor,'receipt',receipt,t=>services.receipt(t,actor,receipt));
 r=await inject(accessApp,{method:'POST',url:'/api/v1/access/warehouse-grants',headers,body:p({...warehouseGrant,clientOperationId:uuid(),expectedVersion:1,active:false,reason:'Revoke assigned warehouse'})});assert.equal(r.status,200);
 await assert.rejects(command(db,actor,'receipt',receipt,t=>services.receipt(t,actor,receipt)),(e:any)=>e.code==='WAREHOUSE_ACCESS');
 assert.equal((await db.query('SELECT count(*)::int n FROM boxes WHERE id=$1',[created.id])).rows[0].n,1);
 // Membership actor keys preserve history across companies without changing users.org_id.
 assert.equal((await db.query('SELECT org_id FROM users WHERE id=$1',[user])).rows[0].org_id,other);
 assert.ok((await db.query("SELECT id FROM inventory_events WHERE org_id='demo' AND actor_id=$1",[user])).rows.length);
});
test('access: unauthorized context switching, last administrator removal and stale access edits fail safely',async()=>{
 const headers=await httpSession(accessApp), operator=await httpSession(accessApp,'demo-operator');
 assert.equal((await inject(accessApp,{method:'POST',url:'/api/v1/auth/context',headers:operator,body:{companyId:'demo',warehouseId:newWarehouse.id}})).status,403);
 assert.equal((await inject(accessApp,{method:'POST',url:'/api/v1/auth/context',headers,body:{companyId:'foreign-org'}})).status,403);
 assert.equal((await inject(accessApp,{method:'POST',url:'/api/v1/access/memberships',headers:operator,body:p({email:'demo@example.invalid',expectedVersion:1,role:'administrator',active:false,reason:'Forbidden role edit'})})).status,403);
 const r=await inject(accessApp,{method:'POST',url:'/api/v1/access/memberships',headers,body:p({email:'demo@example.invalid',expectedVersion:1,role:'operator',active:true,reason:'Attempt last administrator demotion'})});assert.equal(r.status,422);assert.equal(r.body.error.code,'LAST_ADMINISTRATOR');
 const stale=await inject(accessApp,{method:'POST',url:'/api/v1/access/memberships',headers,body:p({email:'demo@example.invalid',expectedVersion:0,role:'administrator',active:true,reason:'Stale membership review'})});assert.equal(stale.status,409);
 const still=(await inject(accessApp,{url:'/api/v1/session',headers})).body;assert.equal(still.user.org_id,'demo');assert.equal(still.user.role,'administrator');
});
test('access: order, preparation, allocation and readiness remain inside their selected warehouse',async()=>{
 const base=await httpSession(accessApp), selected=await selectContext(accessApp,base,'demo',newWarehouse.id),headers=selected.headers;
 let r=await inject(accessApp,{method:'POST',url:'/api/v1/orders',headers,body:p({customerId:'c3',destinationId:'d3',lines:[{productId:'p1',quantity:'4',unit:'piece'}]})});
 assert.equal(r.status,200);const order=r.body;assert.equal(order.warehouse_id,newWarehouse.id);
 const line=(await db.query('SELECT * FROM order_lines WHERE order_id=$1',[order.id])).rows[0];assert.equal(line.warehouse_id,newWarehouse.id);
 r=await inject(accessApp,{method:'POST',url:'/api/v1/orders/'+order.id+'/allocate',headers,body:p({expectedVersion:order.version,boxId:scopedBox.id,orderLineId:line.id,quantity:'4'})});assert.equal(r.status,200);
 r=await inject(accessApp,{method:'POST',url:'/api/v1/preparation-batches',headers,body:p({businessDate:'2026-10-30',orderIds:[order.id]})});assert.equal(r.status,200);assert.equal(r.body.warehouse_id,newWarehouse.id);
 const legacy=await httpSession(accessApp);
 assert.equal((await inject(accessApp,{method:'POST',url:'/api/v1/preparation-batches',headers:legacy,body:p({businessDate:'2026-10-30',orderIds:[order.id]})})).status,404);
 const shown=(await inject(accessApp,{url:'/api/v1/workspace',headers})).body;
 assert.ok(shown.orders.some((o:any)=>o.id===order.id));assert.ok(!shown.orders.some((o:any)=>o.id==='o1'));
 assert.ok(shown.allocations.every((a:any)=>a.warehouse_id===newWarehouse.id));
});

test('access: one identity switches company roles and membership revocation keeps recovery available',async()=>{
 const bcrypt=(await import('bcryptjs')).default,org=uuid(),user=uuid(),email=user+'@example.invalid',password=uuid()+uuid();
 await db.query("INSERT INTO organizations VALUES($1,'Synthetic shared-membership company',true)",[org]);
 await db.query("INSERT INTO company_configuration(org_id,display_name) VALUES($1,'Synthetic shared-membership company')",[org]);
 await db.query("INSERT INTO users(id,org_id,email,name,role,password_hash) VALUES($1,$2,$3,'Synthetic multi-company staff','reviewer',$4)",[user,org,email,await bcrypt.hash(password,4)]);
 const adminHeaders=await httpSession(accessApp);
 let r=await inject(accessApp,{method:'POST',url:'/api/v1/access/memberships',headers:adminHeaders,body:p({email,role:'operator',active:true,expectedVersion:0,reason:'Approve membership for synthetic staff'})});assert.equal(r.status,200);
 r=await inject(accessApp,{method:'POST',url:'/api/v1/access/warehouse-grants',headers:adminHeaders,body:p({userId:user,warehouseId:'demo:legacy',expectedVersion:0,active:true,reason:'Approve legacy warehouse work'})});assert.equal(r.status,200);
 const boot=await inject(accessApp,{url:'/api/v1/session'});
 const login=await inject(accessApp,{method:'POST',url:'/api/v1/auth/login',headers:{Cookie:boot.headers['set-cookie'][0].split(';')[0],'X-CSRF-Token':boot.body.csrf},body:{email,password}});assert.equal(login.status,200);
 let cookie=login.headers['set-cookie'][0].split(';')[0],session=(await inject(accessApp,{url:'/api/v1/session',headers:{Cookie:cookie}})).body;
 assert.equal(session.user.org_id,org);assert.equal(session.user.role,'reviewer');assert.equal(session.companies.length,2);
 const current=await selectContext(accessApp,{Cookie:cookie,'X-CSRF-Token':session.csrf},'demo','demo:legacy');
 assert.equal(current.session.user.role,'operator');assert.equal(current.session.user.home_org_id,org);
 assert.equal((await inject(accessApp,{url:'/api/v1/access/directory',headers:current.headers})).status,403);
 assert.equal((await inject(accessApp,{method:'POST',url:'/api/v1/receipts',headers:current.headers,body:p({customerId:null,locationId:'l1',contents:[]})})).status,200);
 r=await inject(accessApp,{method:'POST',url:'/api/v1/access/memberships',headers:adminHeaders,body:p({email,role:'operator',active:false,expectedVersion:1,reason:'Revoke company assignment'})});assert.equal(r.status,200);
 session=(await inject(accessApp,{url:'/api/v1/session',headers:current.headers})).body;
 assert.equal(session.user,null);assert.equal(session.identity.id,user);assert.ok(session.companies.some((c:any)=>c.org_id===org));
 assert.equal((await inject(accessApp,{url:'/api/v1/boxes/b1',headers:current.headers})).status,401);
 const recovered=await selectContext(accessApp,current.headers,org);assert.equal(recovered.session.user.role,'reviewer');
 assert.equal((await inject(accessApp,{method:'POST',url:'/api/v1/auth/logout',headers:recovered.headers,body:{}})).status,200);
});
test('access: queued exports and existing document sessions fail closed after warehouse grant revocation',async()=>{
 const adminHeaders=await httpSession(accessApp),selected=await selectContext(accessApp,adminHeaders,'demo',newWarehouse.id);
 const queued=(await inject(accessApp,{method:'POST',url:'/api/v1/jobs',headers:selected.headers,body:p({kind:'inventory-export'})})).body;
 const editor=await httpSession(accessApp),grant=(await db.query("SELECT * FROM warehouse_grants WHERE user_id='demo-admin' AND warehouse_id=$1",[newWarehouse.id])).rows[0];
 let r=await inject(accessApp,{method:'POST',url:'/api/v1/access/warehouse-grants',headers:editor,body:p({userId:'demo-admin',warehouseId:newWarehouse.id,expectedVersion:grant.version,active:false,reason:'Synthetic revoked worker-access check'})});assert.equal(r.status,200);
 assert.equal((await inject(accessApp,{url:'/api/v1/boxes/'+scopedBox.id,headers:selected.headers})).status,403);
 const workspace=(await inject(accessApp,{url:'/api/v1/workspace',headers:selected.headers})).body;assert.equal(workspace.warehouse,null);assert.equal(workspace.boxes,undefined);
 for(let i=0;i<3;i++){await db.query('UPDATE jobs SET available_at=now() WHERE id=$1',[queued.id]);await workOnce(db);}
 const job=(await db.query('SELECT * FROM jobs WHERE id=$1',[queued.id])).rows[0];assert.equal(job.status,'failed');assert.equal(job.result,null);
 r=await inject(accessApp,{method:'POST',url:'/api/v1/access/warehouse-grants',headers:editor,body:p({userId:'demo-admin',warehouseId:newWarehouse.id,expectedVersion:grant.version+1,active:true,reason:'Restore synthetic test assignment'})});assert.equal(r.status,200);
});
test('access: restore preserves memberships, warehouses and audit scopes without duplicate bootstrap rows',async()=>{
 const source=await snapshot(db),target=await openDatabase(null,':memory:');
 try{
 await migrate(target);await restoreSnapshot(target,source);
 for(const table of ['warehouses','company_memberships','warehouse_grants','inventory_events','boxes'])assert.equal((await target.query('SELECT count(*)::int n FROM '+table)).rows[0].n,source.tables[table].length);
 assert.equal((await target.query('SELECT warehouse_id FROM boxes WHERE id=$1',[scopedBox.id])).rows[0].warehouse_id,newWarehouse.id);
 const {resolveActor}=await import('../packages/domain/context.js');
 const a=await resolveActor(target,'demo-admin','demo',newWarehouse.id);assert.equal(a?.warehouse_id,newWarehouse.id);
 }finally{await target.close();}
});
test('access: legacy v2 backup restores only its original namespace and exact home membership',async()=>{
 const {splitStatements}=await import('../packages/database/sql.js'),{readdir}=await import('node:fs/promises');
 const old=await openDatabase(null,':memory:'),target=await openDatabase(null,':memory:');
 try{
 await old.query('CREATE TABLE migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
 for(const name of (await readdir('packages/database/migrations')).filter(n=>n.endsWith('.sql')&&n<'010').sort()){
 for(const sql of splitStatements(await readFile('packages/database/migrations/'+name,'utf8')))await old.query(sql);
 await old.query('INSERT INTO migrations(name) VALUES($1)',[name]);
 }
 await seed(old);
 const {backupTables}=await import('../packages/database/backup.js');const tables:Record<string,any[]>={};
 for(const name of backupTables.filter(n=>!['warehouses','company_memberships','warehouse_grants','product_imports','product_import_items','pallet_groups','pallet_group_memberships'].includes(n)))tables[name]=(await old.query('SELECT * FROM '+name)).rows;
 await migrate(target);await restoreSnapshot(target,{format:'jadesun-v2',tables});
 assert.equal((await target.query('SELECT count(*)::int n FROM warehouses')).rows[0].n,1);
 assert.equal((await target.query("SELECT warehouse_id FROM boxes WHERE id='b1'")).rows[0].warehouse_id,'demo:legacy');
 assert.equal((await target.query("SELECT role FROM company_memberships WHERE user_id='demo-operator' AND org_id='demo'")).rows[0].role,'operator');
 assert.deepEqual((await target.query("SELECT data FROM inventory_events WHERE id='seed-event'")).rows[0].data,tables.inventory_events[0].data);
 }finally{await old.close();await target.close();}
});
test('access: device draft namespaces never fall back across warehouses or companies',async()=>{
 const {draftScope,legacyDraftScopes}=await import('../apps/web/src/draft-scope.js');
 const home={id:'same-staff',org_id:'company-a',warehouse_id:'company-a:legacy',home_org_id:'company-a'};
 assert.notEqual(draftScope(home),draftScope({...home,warehouse_id:'another-warehouse'}));
 assert.notEqual(draftScope(home),draftScope({...home,org_id:'company-b',warehouse_id:'company-b:legacy'}));
 assert.deepEqual(legacyDraftScopes({...home,warehouse_id:'another-warehouse'}),[]);
 assert.deepEqual(legacyDraftScopes({...home,org_id:'company-b',warehouse_id:'company-b:legacy'}),[]);
});

test('access: stale browser context headers reject writes before applying a command',async()=>{
 const headers=await httpSession(accessApp),selected=await selectContext(accessApp,headers,'demo',newWarehouse.id);
 const operation=uuid(),before=(await db.query("SELECT count(*)::int n FROM operations WHERE org_id='demo'")).rows[0].n;
 const r=await inject(accessApp,{method:'POST',url:'/api/v1/receipts',headers:{...selected.headers,'X-Company-Context':'demo','X-Warehouse-Context':'demo:legacy'},body:{clientOperationId:operation,customerId:null,locationId:newLocation.id,contents:[]}});
 assert.equal(r.status,409);assert.equal(r.body.error.code,'CONTEXT_CHANGED');
 assert.equal((await db.query("SELECT count(*)::int n FROM operations WHERE org_id='demo'")).rows[0].n,before);
 assert.equal((await db.query("SELECT count(*)::int n FROM operations WHERE operation_id=$1",[operation])).rows[0].n,0);
});

test('access: concurrent administrator demotions leave one active administrator',async()=>{
 const {changeMembership}=await import('../packages/domain/access.js');
 const org=uuid(),one=uuid(),two=uuid();
 await db.query("INSERT INTO organizations VALUES($1,'Synthetic concurrent administration',true)",[org]);
 for(const id of [one,two])await db.query("INSERT INTO users(id,org_id,email,name,role) VALUES($1,$2,$3,'Synthetic administrator','administrator')",[id,org,id+'@example.invalid']);
 const actor=(id:string):Actor=>({id,org_id:org,role:'administrator',name:'Synthetic administrator',email:id+'@example.invalid',warehouse_id:org+':legacy'});
 const first=p({email:one+'@example.invalid',expectedVersion:1,role:'operator',active:true,reason:'Synthetic concurrent demotion A'}),second=p({email:two+'@example.invalid',expectedVersion:1,role:'operator',active:true,reason:'Synthetic concurrent demotion B'});
 const result=await Promise.allSettled([
 command(db,actor(one),'access-membership',first,t=>changeMembership(t,actor(one),first)),
 command(raceDB,actor(two),'access-membership',second,t=>changeMembership(t,actor(two),second)),
 ]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await db.query("SELECT count(*)::int n FROM company_memberships WHERE org_id=$1 AND role='administrator' AND active",[org])).rows[0].n,1);
});

test('access: an unrecognised legacy role is retained for review but grants no active session',async()=>{
 const {resolveActor,contexts}=await import('../packages/domain/context.js');
 const org=uuid(),id=uuid();
 await db.query("INSERT INTO organizations VALUES($1,'Synthetic legacy-role review',true)",[org]);
 await db.query("INSERT INTO users(id,org_id,email,name,role) VALUES($1,$2,$3,'Unmapped role','unconfirmed-custom-role')",[id,org,id+'@example.invalid']);
 assert.equal(await resolveActor(db,id),null);assert.deepEqual(await contexts(db,id),[]);
 assert.equal((await db.query('SELECT role FROM company_memberships WHERE user_id=$1 AND org_id=$2',[id,org])).rows[0].role,'unconfirmed-custom-role');
});

// PLATFORM-003 catalogue import: native mode shares raceDB's independent connection pool.
import {previewProductImport,commitProductImport,reviewProductImport} from '../packages/domain/imports.js';
const importMapping={sku:0,name:1,name_zh:2,profile:3,unit:4,handling:null};
const csvProducts=(codes:string[])=>'sku,name,name_zh,profile,unit,ignored_price\r\n'+codes.map(c=>`${c},Synthetic import ${c},示例,General goods,piece,unverified`).join('\r\n');
const importPayload=(codes:string[])=>p({filename:'synthetic-products.csv',csv:csvProducts(codes),mapping:importMapping,reason:'Synthetic import QA source'});
let importBatch:any;
const importActor={...admin,warehouse_id:'demo:legacy'};
test('imports: preview persists original evidence with zero product/stock changes and retry deduplication',async()=>{
 const sku='000-IMPORT-'+uuid(),payload=importPayload([sku]);
 const before=(await db.query('SELECT (SELECT count(*) FROM products)::int products,(SELECT count(*) FROM contents)::int contents')).rows[0];
 importBatch=await command(db,importActor,'import-products-preview',payload,t=>previewProductImport(t,importActor,payload));
 assert.equal(importBatch.source_csv,payload.csv);assert.equal(importBatch.canCommit,true);assert.equal(importBatch.source_hash.length,64);assert.equal(importBatch.ignoredColumns[0].name,'ignored_price');assert.equal(importBatch.rows[0].values.sku,sku);
 assert.deepEqual((await db.query('SELECT (SELECT count(*) FROM products)::int products,(SELECT count(*) FROM contents)::int contents')).rows[0],before);
 assert.equal((await command(db,importActor,'import-products-preview',payload,t=>previewProductImport(t,importActor,payload))).id,importBatch.id);
 const again={...payload,clientOperationId:uuid()};assert.equal((await command(db,importActor,'import-products-preview',again,t=>previewProductImport(t,importActor,again))).id,importBatch.id);
 await assert.rejects(command(db,importActor,'import-products-preview',{...payload,reason:'Different payload'},t=>previewProductImport(t,importActor,payload)),(e:any)=>e.code==='IDEMPOTENCY_MISMATCH');
});
test('imports: valid commit is atomic/idempotent and audit links retain source after downstream receipt',async()=>{
 const before=(await db.query('SELECT count(*)::int n FROM contents')).rows[0].n,payload=p({expectedVersion:importBatch.version});
 const result=await command(db,importActor,'import-products-commit:'+importBatch.id,payload,t=>commitProductImport(t,importActor,importBatch.id,payload));
 assert.equal(result.status,'committed');assert.equal(result.productIds.length,1);assert.equal(result.version,2);assert.equal((await db.query('SELECT count(*)::int n FROM contents')).rows[0].n,before);
 assert.deepEqual((await command(db,importActor,'import-products-commit:'+importBatch.id,payload,t=>commitProductImport(t,importActor,importBatch.id,payload))).productIds,result.productIds);
 const again=p({expectedVersion:1});assert.deepEqual((await command(db,importActor,'import-products-commit:'+importBatch.id,again,t=>commitProductImport(t,importActor,importBatch.id,again))).productIds,result.productIds);
 const received=p({customerId:null,locationId:'l1',sourceLabel:'Synthetic imported product receipt',condition:'good',contents:[{productId:result.productIds[0],unit:'piece',quantity:'2',verified:true}]});await command(db,importActor,'receipt',received,t=>services.receipt(t,importActor,received));
 await assert.rejects(db.query('DELETE FROM product_imports WHERE id=$1',[result.id]),/history/);await assert.rejects(db.query('UPDATE product_import_items SET product_id=$1 WHERE import_id=$2',['p1',result.id]),/immutable/);
 assert.equal((await reviewProductImport(db,importActor,result.id)).productIds[0],result.productIds[0]);
 assert.equal((await db.query("SELECT count(*)::int n FROM inventory_events WHERE entity_id=$1 AND kind='product_import.committed'",[result.id])).rows[0].n,1);
});
test('imports: invalid rows/duplicate SKU/unknown unit block entire batch with no partial commit',async()=>{
 const sku='IMPORT-INVALID-'+uuid(),payload=importPayload([sku,sku]);payload.csv=payload.csv.replace(/piece,unverified$/,'boxes,unverified');
 const staged=await command(db,importActor,'import-products-preview',payload,t=>previewProductImport(t,importActor,payload));assert.equal(staged.canCommit,false);assert.ok(staged.rows[1].issues.some((i:any)=>i.field==='unit'));assert.ok(staged.rows[1].issues.some((i:any)=>i.field==='sku'));
 await assert.rejects(command(db,importActor,'import-products-commit:'+staged.id,p({expectedVersion:1}),t=>commitProductImport(t,importActor,staged.id,p({expectedVersion:1}))),(e:any)=>e.code==='IMPORT_REVIEW_REQUIRED'&&e.details.rows.length===2);
 assert.equal((await db.query('SELECT count(*)::int n FROM products WHERE sku=$1',[sku])).rows[0].n,0);assert.equal((await reviewProductImport(db,importActor,staged.id)).status,'review');
});
test('imports: catalogue changes after preview return recoverable conflict, retaining source/mapping',async()=>{
 const sku='IMPORT-CONFLICT-'+uuid(),payload=importPayload([sku,'SECOND-'+sku]);const staged=await command(db,importActor,'import-products-preview',payload,t=>previewProductImport(t,importActor,payload));
 await db.query("INSERT INTO products(id,org_id,sku,name,profile,unit) VALUES($1,'demo',$2,'Concurrent manual product','General goods','piece')",[uuid(),sku]);
 const c=p({expectedVersion:1});await assert.rejects(command(db,importActor,'import-products-commit:'+staged.id,c,t=>commitProductImport(t,importActor,staged.id,c)),(e:any)=>e.code==='IMPORT_REVIEW_REQUIRED'&&e.details.source_csv===payload.csv);
 assert.equal((await db.query('SELECT count(*)::int n FROM products WHERE sku=$1',['SECOND-'+sku])).rows[0].n,0);
 const stale=p({expectedVersion:2});await assert.rejects(command(db,importActor,'import-products-commit:'+staged.id,stale,t=>commitProductImport(t,importActor,staged.id,stale)),(e:any)=>e.code==='VERSION_CONFLICT');
});
test('imports: concurrent overlapping commits create one catalogue identity only',async()=>{
 const sku='IMPORT-RACE-'+uuid(),first=importPayload([sku]),second={...importPayload([sku]),csv:csvProducts([sku]).replace('示例','另一个')};
 const a=await command(db,importActor,'import-products-preview',first,t=>previewProductImport(t,importActor,first)),b=await command(db,importActor,'import-products-preview',second,t=>previewProductImport(t,importActor,second));
 const cp=p({expectedVersion:1}),cq=p({expectedVersion:1});
 const results=await Promise.allSettled([command(db,importActor,'import-products-commit:'+a.id,cp,t=>commitProductImport(t,importActor,a.id,cp)),command(raceDB,importActor,'import-products-commit:'+b.id,cq,t=>commitProductImport(t,importActor,b.id,cq))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await db.query('SELECT count(*)::int n FROM products WHERE org_id=$1 AND sku=$2',['demo',sku])).rows[0].n,1);
 assert.equal((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.code,'IMPORT_REVIEW_REQUIRED');
});
test('imports: HTTP permissions, cross-company/warehouse reads/reports/commit/list are isolated',async()=>{
 const app=createApp(db,{demo:true}),headers=await httpSession(app),operator=await httpSession(app,'demo-operator');
 const payload=importPayload(['HTTP-'+uuid()]);const staged=await inject(app,{method:'POST',url:'/api/v1/imports/products/preview',headers,body:payload});assert.equal(staged.status,200);
 const otherWarehouse=await selectContext(app,headers,'demo',newWarehouse.id);
 for(const suffix of ['', '/errors.csv'])assert.equal((await inject(app,{url:'/api/v1/imports/products/'+staged.body.id+suffix,headers:otherWarehouse.headers})).status,404);
 assert.equal((await inject(app,{method:'POST',url:'/api/v1/imports/products/'+staged.body.id+'/commit',headers:otherWarehouse.headers,body:p({expectedVersion:1})})).status,404);
 assert.equal((await inject(app,{url:'/api/v1/imports/products/'+staged.body.id,headers:operator})).status,403);
 assert.equal((await inject(app,{method:'POST',url:'/api/v1/imports/products/preview',headers:operator,body:payload})).status,403);
 const otherOrg=(await db.query("SELECT org_id FROM users WHERE org_id<>'demo' AND active ORDER BY id LIMIT 1")).rows[0].org_id;
 await assert.rejects(reviewProductImport(db,{...importActor,org_id:otherOrg},staged.body.id),(e:any)=>e.code==='NOT_FOUND');
 const refreshedHeaders=await httpSession(app);const report=await inject(app,{url:'/api/v1/imports/products/'+staged.body.id+'/errors.csv',headers:refreshedHeaders});assert.equal(report.status,200);assert.match(report.headers['content-type'],/text\/csv/);
 assert.equal((await inject(app,{url:'/api/v1/imports/products?before=not-a-cursor',headers:refreshedHeaders})).status,422);
 const list=await inject(app,{url:'/api/v1/imports/products',headers:otherWarehouse.headers});assert.ok(!list.body.items.some((r:any)=>r.id===staged.body.id));
});
test('imports: v4 restore retains originals/links and legacy v3 restores with empty imports',async()=>{
 const archive=await snapshot(db),target=await openDatabase(null,':memory:');assert.equal(archive.format,'jadesun-v5');
 try{await migrate(target);await restoreSnapshot(target,archive);assert.equal((await reviewProductImport(target,importActor,importBatch.id)).source_csv,importBatch.source_csv);assert.equal((await target.query('SELECT count(*)::int n FROM product_import_items')).rows[0].n,archive.tables.product_import_items.length)}finally{await target.close()}
 const legacy={...archive,format:'jadesun-v3',tables:{...archive.tables}};delete legacy.tables.product_imports;delete legacy.tables.product_import_items;delete legacy.tables.pallet_groups;delete legacy.tables.pallet_group_memberships;
 const old=await openDatabase(null,':memory:');try{await migrate(old);await restoreSnapshot(old,legacy);assert.equal((await old.query('SELECT count(*)::int n FROM product_imports')).rows[0].n,0)}finally{await old.close()}
 const bad=await openDatabase(null,':memory:');try{await migrate(bad);const partial={...archive,tables:{...archive.tables}};delete partial.tables.product_import_items;await assert.rejects(restoreSnapshot(bad,partial),/Incomplete import/)}finally{await bad.close()}
});

test('imports: an insertion failure rolls back every product/link/event and retry recovers',async()=>{
 const skus=['ROLLBACK-A-'+uuid(),'ROLLBACK-B-'+uuid()],payload=importPayload(skus),batch=await command(db,importActor,'import-products-preview',payload,t=>previewProductImport(t,importActor,payload));
 const cp=p({expectedVersion:1});let inserts=0;
 const failing:DB={...db,transaction:f=>db.transaction(t=>f({...t,query:async(sql,params)=>{if(sql.startsWith('INSERT INTO products(')&&++inserts===2)throw new Error('Synthetic second insertion failure');return t.query(sql,params)}}))};
 await assert.rejects(command(failing,importActor,'import-products-commit:'+batch.id,cp,t=>commitProductImport(t,importActor,batch.id,cp)),/Synthetic/);
 assert.equal((await db.query('SELECT count(*)::int n FROM products WHERE sku=ANY($1::text[])',[skus])).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int n FROM product_import_items WHERE import_id=$1',[batch.id])).rows[0].n,0);
 assert.equal((await reviewProductImport(db,importActor,batch.id)).status,'review');
 assert.equal((await command(db,importActor,'import-products-commit:'+batch.id,cp,t=>commitProductImport(t,importActor,batch.id,cp))).productIds.length,2);
});
test('imports: second-company HTTP session cannot read/export/commit the first company preview',async()=>{
 const org=uuid();await db.query("INSERT INTO organizations VALUES($1,'Synthetic import isolation company',true)",[org]);
 await db.query("INSERT INTO company_memberships(user_id,org_id,role) VALUES('demo-admin',$1,'administrator')",[org]);
 await db.query("INSERT INTO warehouse_grants(user_id,org_id,warehouse_id) VALUES('demo-admin',$1,$2)",[org,org+':legacy']);
 const app=createApp(db,{demo:true}),headers=await httpSession(app),other=await selectContext(app,headers,org,org+':legacy');
 for(const suffix of ['', '/errors.csv'])assert.equal((await inject(app,{url:'/api/v1/imports/products/'+importBatch.id+suffix,headers:other.headers})).status,404);
 assert.equal((await inject(app,{method:'POST',url:'/api/v1/imports/products/'+importBatch.id+'/commit',headers:other.headers,body:p({expectedVersion:1})})).status,404);
 const response=await inject(app,{method:'POST',url:'/api/v1/imports/products/preview',headers:other.headers,body:importPayload([importBatch.rows[0].values.sku])});assert.equal(response.status,200);assert.equal(response.body.org_id,org);assert.equal(response.body.canCommit,true);
});

test('customer order form: multi-product order is atomic, scoped and idempotent',async()=>{
 const app=createApp(db,{demo:true}),headers=await httpSession(app),payload=p({customerId:'c1',destinationId:'d1',lines:[{productId:'p1',quantity:'2',unit:'piece'},{productId:'p2',quantity:'1.5',unit:'kg'}]});
 const first=await inject(app,{method:'POST',url:'/api/v1/orders',headers,body:payload});assert.equal(first.status,200);const id=first.body.id;
 const retry=await inject(app,{method:'POST',url:'/api/v1/orders',headers,body:payload});assert.equal(retry.status,200);assert.equal(retry.body.id,id);
 const rows=(await db.query('SELECT product_id,quantity,unit FROM order_lines WHERE order_id=$1 ORDER BY product_id',[id])).rows;assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.product_id),['p1','p2']);
 const duplicate=await inject(app,{method:'POST',url:'/api/v1/orders',headers,body:p({customerId:'c1',destinationId:'d1',lines:[{productId:'p1',quantity:'1',unit:'piece'},{productId:'p1',quantity:'2',unit:'piece'}]})});assert.equal(duplicate.status,422);
 const before=(await db.query("SELECT count(*)::int n FROM orders WHERE org_id='demo'")).rows[0].n;
 const invalid=await inject(app,{method:'POST',url:'/api/v1/orders',headers,body:p({customerId:'c1',destinationId:'d1',lines:[{productId:'p1',quantity:'1',unit:'piece'},{productId:'p2',quantity:'2',unit:'piece'}]})});assert.equal(invalid.status,422);assert.equal((await db.query("SELECT count(*)::int n FROM orders WHERE org_id='demo'")).rows[0].n,before);
 const outsider=await inject(app,{method:'POST',url:'/api/v1/orders',headers,body:p({customerId:'c1',destinationId:'d2',lines:[{productId:'p1',quantity:'1',unit:'piece'}]})});assert.equal(outsider.status,422);
});

import {createPalletGroup,changePalletGroup,palletGroupList} from '../packages/domain/pallet-groups.js';
test('pallet group: multiple independent pallets, scoped, versioned and retry-safe',async()=>{
 const actor={...admin,warehouse_id:'demo:legacy'},tripId=uuid(),palletA=uuid(),palletB=uuid();
 await db.query("INSERT INTO trips(id,org_id,code,business_date,warehouse_id) VALUES($1,'demo',$2,'2026-10-28','demo:legacy')",[tripId,'QA-GROUP-'+tripId]);
 for(const id of [palletA,palletB])await db.query("INSERT INTO pallets(id,org_id,code,location_id,warehouse_id) VALUES($1,'demo',$2,'l1','demo:legacy')",[id,'QA-PAL-'+id]);
 const create=p({tripId,name:'Synthetic area group',reason:'Synthetic planning check'}),group=await command(db,actor,'pallet-group-create',create,t=>createPalletGroup(t,actor,create));
 const addA=p({expectedVersion:1,palletId:palletA,reason:'Synthetic group planning'}),added=await command(db,actor,'pallet-group-add:'+group.id,addA,t=>changePalletGroup(t,actor,group.id,addA,false));assert.equal(added.version,2);
 assert.equal((await command(db,actor,'pallet-group-add:'+group.id,addA,t=>changePalletGroup(t,actor,group.id,addA,false))).version,2);
 const addB=p({expectedVersion:2,palletId:palletB,reason:'Synthetic group planning'});await command(db,actor,'pallet-group-add:'+group.id,addB,t=>changePalletGroup(t,actor,group.id,addB,false));
 const listed=(await palletGroupList(db,actor)).find(g=>g.id===group.id);assert.equal(listed.pallets.length,2);assert.equal(listed.pallets[0].location_code,'RCV-01');
 const stale=p({expectedVersion:2,palletId:palletA,reason:'Stale change'});await assert.rejects(command(db,actor,'pallet-group-remove:'+group.id,stale,t=>changePalletGroup(t,actor,group.id,stale,true)),(e:any)=>e.code==='VERSION_CONFLICT');
 const remove=p({expectedVersion:3,palletId:palletA,reason:'Synthetic ungroup'});await command(db,actor,'pallet-group-remove:'+group.id,remove,t=>changePalletGroup(t,actor,group.id,remove,true));
 const remaining=(await palletGroupList(db,actor)).find(g=>g.id===group.id);assert.deepEqual(remaining.pallets.map((x:any)=>x.pallet_id),[palletB]);
 assert.equal((await db.query('SELECT location_id FROM pallets WHERE id=$1',[palletA])).rows[0].location_id,'l1');assert.equal((await db.query('SELECT count(*)::int n FROM pallet_group_memberships WHERE group_id=$1',[group.id])).rows[0].n,2);
 await assert.rejects(db.query('DELETE FROM pallet_group_memberships WHERE group_id=$1',[group.id]),/immutable/);
 const wrong={...actor,warehouse_id:newWarehouse.id};await assert.rejects(changePalletGroup(db,wrong,group.id,remove,true),(e:any)=>e.code==='NOT_FOUND');
});
test('pallet group: duplicate grouping and unauthorized list fail closed',async()=>{
 const app=createApp(db,{demo:true}),headers=await httpSession(app),operator=await httpSession(app,'demo-operator');
 assert.equal((await inject(app,{url:'/api/v1/pallet-groups',headers:operator})).status,403);
 const groups=(await inject(app,{url:'/api/v1/pallet-groups',headers})).body,g=groups.find((v:any)=>v.name==='Synthetic area group');assert.ok(g);
 const duplicate=await inject(app,{method:'POST',url:'/api/v1/pallet-groups/'+g.id+'/add',headers,body:p({expectedVersion:g.version,palletId:g.pallets[0].pallet_id,reason:'Duplicate synthetic scan'})});assert.equal(duplicate.status,409);assert.equal(duplicate.body.error.code,'GROUP_MEMBERSHIP');
});
test('pallet group: backup restores active and removed membership history; v4 remains readable',async()=>{
 const archive=await snapshot(db),target=await openDatabase(null,':memory:');
 try{await migrate(target);await restoreSnapshot(target,archive);assert.equal((await target.query('SELECT count(*)::int n FROM pallet_group_memberships')).rows[0].n,archive.tables.pallet_group_memberships.length);assert.ok((await target.query('SELECT id FROM pallet_group_memberships WHERE removed_at IS NOT NULL')).rows.length>0)}finally{await target.close()}
 const old={...archive,format:'jadesun-v4',tables:{...archive.tables}};delete old.tables.pallet_groups;delete old.tables.pallet_group_memberships;
 const legacy=await openDatabase(null,':memory:');try{await migrate(legacy);await restoreSnapshot(legacy,old);assert.equal((await legacy.query('SELECT count(*)::int n FROM pallet_groups')).rows[0].n,0)}finally{await legacy.close()}
});

test('worker sheet: full order lines are escaped, scoped and read-only',async()=>{
 const app=createApp(db,{demo:true}),adminHeaders=await httpSession(app),operator=await httpSession(app,'demo-operator'),driver=await httpSession(app,'demo-driver');
 const before=(await db.query('SELECT count(*)::int n FROM inventory_events')).rows[0].n;
 const r=await inject(app,{url:'/api/v1/orders/o1/worker-sheet',headers:operator});assert.equal(r.status,200);const body=r.raw.toString();assert.match(body,/Warehouse worker order sheet/);assert.match(body,/INTERNAL WORKING COPY/);assert.match(body,/Calendar/);assert.match(body,/50 piece/);assert.match(body,/Preparation is not delivery/);assert.match(r.headers['content-security-policy'],/default-src 'none'/);
 assert.equal((await db.query('SELECT count(*)::int n FROM inventory_events')).rows[0].n,before);
 assert.equal((await inject(app,{url:'/api/v1/orders/o1/worker-sheet',headers:driver})).status,403);
 const scope=await selectContext(app,adminHeaders,'demo',newWarehouse.id);assert.equal((await inject(app,{url:'/api/v1/orders/o1/worker-sheet',headers:scope.headers})).status,404);
 const previous=(await db.query("SELECT name FROM products WHERE id='p1'")).rows[0].name;try{await db.query("UPDATE products SET name=$1 WHERE id='p1'",['<script>alert(1)</script>']);const h=await httpSession(app);const text=(await inject(app,{url:'/api/v1/orders/o1/worker-sheet',headers:h})).raw.toString();assert.ok(text.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));assert.ok(!text.includes('<script>alert(1)</script>'));}finally{await db.query("UPDATE products SET name=$1 WHERE id='p1'",[previous]);}
});

test('recognition: local synthetic image is private, retry-safe and cannot change stock',async(t)=>{
 if(!(await ocrStatus()).local.configured){t.skip('Tesseract or configured language unavailable');return}
 const temp=await mkdtemp(path.join(os.tmpdir(),'warehouse-ocr-'));
 try {
  const bytes=await readFile('tests/fixtures/synthetic-ocr.png'),id=uuid(),hash=createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(temp,id),bytes);
  await db.query("INSERT INTO documents(id,org_id,box_id,name,storage_key,mime,sha256,size) VALUES($1,'demo','b1','synthetic-ocr.png',$1,'image/png',$2,$3)",[id,hash,bytes.length]);
  const app=createApp(db,{demo:true}),headers=await httpSession(app,'demo-operator'),driver=await httpSession(app,'demo-driver');
  const body=p({provider:'local',confirmExternalTransfer:false}),count=(await db.query('SELECT count(*)::int n FROM boxes')).rows[0].n;
  const first=await inject(app,{method:'POST',url:`/api/v1/documents/${id}/extract`,headers,body});assert.equal(first.status,200);
  const replay=await inject(app,{method:'POST',url:`/api/v1/documents/${id}/extract`,headers,body});assert.equal(replay.body.id,first.body.id);
  assert.equal((await inject(app,{method:'POST',url:`/api/v1/documents/${id}/extract`,headers,body:p({provider:'gemini',confirmExternalTransfer:false})})).status,422);
  for(let i=0;i<20;i++){const row=(await db.query('SELECT status FROM jobs WHERE id=$1',[first.body.id])).rows[0];if(row.status==='completed'||row.status==='failed')break;await workOnce(db,{uploads:temp})}
  const result=await inject(app,{url:`/api/v1/extractions/${first.body.id}`,headers});assert.equal(result.status,200);assert.equal(result.body.status,'completed');assert.match(result.body.result.text,/SYNTHETIC BOX 0042/i);assert.equal(result.body.result.reviewState,'unreviewed');
  assert.equal((await inject(app,{url:`/api/v1/extractions/${first.body.id}`,headers:driver})).status,403);
  assert.equal((await db.query('SELECT count(*)::int n FROM boxes')).rows[0].n,count);
 } finally {await rm(temp,{recursive:true,force:true})}
});

test('recognition: Gemini adapter transmits only synthetic selected file with server key and rejects bad credentials',async()=>{
 const temp=await mkdtemp(path.join(os.tmpdir(),'warehouse-gemini-')),oldKey=process.env.GEMINI_API_KEY,oldModel=process.env.GEMINI_MODEL,oldFetch=globalThis.fetch;
 try {
  const bytes=await readFile('tests/fixtures/synthetic-ocr.png'),id=uuid();await writeFile(path.join(temp,id),bytes);
  process.env.GEMINI_API_KEY='synthetic-test-key';process.env.GEMINI_MODEL='synthetic-model';
  let called=0;globalThis.fetch=async(input,init)=>{called++;assert.match(String(input),/^https:\/\/generativelanguage\.googleapis\.com\//);assert.equal((init!.headers as any)['x-goog-api-key'],'synthetic-test-key');const body=JSON.parse(String(init!.body));assert.equal(body.contents[0].parts[1].inlineData.data,bytes.toString('base64'));return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'SYNTHETIC BOX 0042'}]}}]}),{status:200})};
  const doc={id,storage_key:id,mime:'image/png',sha256:createHash('sha256').update(bytes).digest('hex')};const out=await extractDocument(doc,'gemini',temp);assert.equal(out.text,'SYNTHETIC BOX 0042');assert.equal(out.reviewState,'unreviewed');assert.equal(called,1);
  globalThis.fetch=async()=>new Response('',{status:401});await assert.rejects(extractDocument(doc,'gemini',temp),(e:any)=>e.code==='OCR_PROVIDER_REJECTED');
 } finally {globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey;if(oldModel===undefined)delete process.env.GEMINI_MODEL;else process.env.GEMINI_MODEL=oldModel;await rm(temp,{recursive:true,force:true})}
});
