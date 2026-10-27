import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID as uuid } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { openDatabase, migrate, type DB } from "../packages/database/index.js";
import { seed } from "../packages/database/seed.js";
import { createApp } from "../apps/api/app.js";
import { workOnce } from "../apps/worker/index.js";
import { inject } from "./inject.js";
let db: DB;
let app: any;
let uploadsDir: string;
let adminHeaders: Record<string, string>;
let driverHeaders: Record<string, string>;

async function httpSession(targetApp: any, userId = "demo-admin") {
  let r = await inject(targetApp, { url: "/api/v1/session" });
  let cookie = r.headers["set-cookie"][0].split(";")[0];
  r = await inject(targetApp, {
    method: "POST",
    url: "/api/v1/auth/demo",
    headers: { cookie, "x-csrf-token": r.body.csrf },
    body: { userId },
  });
  assert.equal(r.status, 200);
  cookie = r.headers["set-cookie"][0].split(";")[0];
  r = await inject(targetApp, { url: "/api/v1/session", headers: { cookie } });
  return {
    cookie,
    "x-csrf-token": r.body.csrf,
    "x-company-context": "demo",
    "x-warehouse-context": "demo:legacy",
  };
}

before(async () => {
  uploadsDir = await mkdtemp(path.join(os.tmpdir(), "jadesun-p0-test-"));
  db = await openDatabase(null, ":memory:");
  await migrate(db);
  await seed(db);
  app = createApp(db, { uploads: uploadsDir, demo: true });

  adminHeaders = await httpSession(app, "demo-admin");
  driverHeaders = await httpSession(app, "demo-driver");
});

after(async () => {
  if (db) await db.close();
  if (uploadsDir) await rm(uploadsDir, { recursive: true, force: true });
});

test("deployment readiness: /api/ready validates database and storage health", async () => {
  const ready = await inject(app, { url: "/api/ready" });
  assert.equal(ready.status, 200);
  assert.equal(ready.body.status, "ready");
  assert.equal(ready.body.storage, "accessible");
  assert.ok(ready.body.database);

  // Simulated storage failure returns 503
  const tempFile = path.join(uploadsDir, "blocking-file");
  await writeFile(tempFile, "blocker");
  const failingApp = createApp(db, { uploads: path.join(tempFile, "sub"), demo: true });
  const failed = await inject(failingApp, { url: "/api/ready" });
  assert.equal(failed.status, 503);
  assert.equal(failed.body.status, "unready");
});

test("worker reliability: leased claims, out-of-transaction streaming export, and completion", async () => {
  const jobId = uuid();
  await db.query(
    "INSERT INTO jobs(id, org_id, actor_id, kind, warehouse_id, status) VALUES($1, 'demo', 'demo-admin', 'inventory-export', 'demo:legacy', 'queued')",
    [jobId]
  );

  const worked = await workOnce(db, { uploads: uploadsDir });
  assert.equal(worked, jobId);

  const job = (await db.query("SELECT * FROM jobs WHERE id=$1", [jobId])).rows[0];
  assert.equal(job.status, "completed");
  assert.equal(job.attempts, 1);
  assert.ok(job.result.boxes.length > 0);
  assert.ok(job.result.generatedAt);
});

test("worker reliability: crash recovery reclaims expired lease and finishes", async () => {
  const jobId = uuid();
  // Simulate worker that crashed after claiming lease: status='processing', lease expired
  await db.query(
    "INSERT INTO jobs(id, org_id, actor_id, kind, warehouse_id, status, attempts, available_at) VALUES($1, 'demo', 'demo-admin', 'inventory-export', 'demo:legacy', 'processing', 1, now() - interval '5 seconds')",
    [jobId]
  );

  const worked = await workOnce(db, { uploads: uploadsDir });
  assert.equal(worked, jobId);

  const job = (await db.query("SELECT * FROM jobs WHERE id=$1", [jobId])).rows[0];
  assert.equal(job.status, "completed");
  assert.equal(job.attempts, 2);
  assert.ok(job.result.boxes.length > 0);
});

test("worker reliability: dead-letter visibility marks job failed after max attempts", async () => {
  const jobId = uuid();
  // Job with unsupported kind that fails validation, attempts already at 2
  await db.query(
    "INSERT INTO jobs(id, org_id, actor_id, kind, warehouse_id, status, attempts) VALUES($1, 'demo', 'demo-admin', 'inventory-export', 'demo:legacy', 'retry', 2)",
    [jobId]
  );
  // Deactivate actor temporarily so job claim fails
  await db.query("UPDATE users SET active=false WHERE id='demo-admin'");
  try {
    await workOnce(db, { uploads: uploadsDir });
    const job = (await db.query("SELECT * FROM jobs WHERE id=$1", [jobId])).rows[0];
    assert.equal(job.status, "failed");
    assert.ok(job.error.includes("Export failed"));
  } finally {
    await db.query("UPDATE users SET active=true WHERE id='demo-admin'");
  }
});

test("server-side search: scoped queries, deterministic cursors and complete aggregates", async () => {
  // 1. Search products
  const pSearch = await inject(app, {
    url: "/api/v1/search?entity=products&limit=2",
    headers: adminHeaders,
  });
  assert.equal(pSearch.status, 200);
  assert.equal(pSearch.body.entity, "products");
  assert.equal(pSearch.body.items.length, 2);
  assert.ok(pSearch.body.totalCount >= 2);
  assert.ok(pSearch.body.completeAggregates.total >= 2);
  assert.ok(pSearch.body.hasMore);
  assert.ok(pSearch.body.nextCursor);

  // 2. Fetch page 2 with deterministic cursor
  const pPage2 = await inject(app, {
    url: `/api/v1/search?entity=products&limit=2&cursor=${pSearch.body.nextCursor}`,
    headers: adminHeaders,
  });
  assert.equal(pPage2.status, 200);
  assert.notEqual(pPage2.body.items[0].id, pSearch.body.items[0].id);
  assert.notEqual(pPage2.body.items[0].id, pSearch.body.items[1].id);

  // 3. Invalid cursor encoding returns 422
  const badCursor = await inject(app, {
    url: "/api/v1/search?entity=products&cursor=not_a_valid_cursor",
    headers: adminHeaders,
  });
  assert.equal(badCursor.status, 422);

  // 4. Mismatched cursor (wrong entity) returns 422
  const wrongEntityCursor = await inject(app, {
    url: `/api/v1/search?entity=boxes&cursor=${pSearch.body.nextCursor}`,
    headers: adminHeaders,
  });
  assert.equal(wrongEntityCursor.status, 422);

  // 5. Search boxes with aggregates
  const bSearch = await inject(app, {
    url: "/api/v1/search?entity=boxes&limit=5",
    headers: adminHeaders,
  });
  assert.equal(bSearch.status, 200);
  assert.ok(bSearch.body.completeAggregates.total > 0);
  assert.ok(typeof bSearch.body.completeAggregates.good === "number");

  // 6. Search filtering with query string
  const filtered = await inject(app, {
    url: "/api/v1/search?entity=boxes&q=b1",
    headers: adminHeaders,
  });
  assert.equal(filtered.status, 200);
  assert.ok(filtered.body.items.length >= 1);
  assert.ok(filtered.body.items.every((b: any) => b.code.toLowerCase().includes("b1") || b.id === "b1"));
});

test("server-side search: driver authorization isolation", async () => {
  // Driver cannot search boxes (forbidden)
  const forbidden = await inject(app, {
    url: "/api/v1/search?entity=boxes",
    headers: driverHeaders,
  });
  assert.equal(forbidden.status, 403);

  // Driver can search assigned trips
  const trips = await inject(app, {
    url: "/api/v1/search?entity=trips",
    headers: driverHeaders,
  });
  assert.equal(trips.status, 200);
  assert.equal(trips.body.entity, "trips");
});

test("workspace payload correctness: driver queries are strictly bounded", async () => {
  const ws = await inject(app, {
    url: "/api/v1/workspace",
    headers: driverHeaders,
  });
  assert.equal(ws.status, 200);
  assert.ok(Array.isArray(ws.body.trips));
  assert.ok(Array.isArray(ws.body.stops));
  assert.ok(Array.isArray(ws.body.shipments));
  assert.ok(Array.isArray(ws.body.shipmentLines));
  // Bounds hold
  assert.ok(ws.body.stops.length <= 200);
  assert.ok(ws.body.shipments.length <= 200);
  assert.ok(ws.body.shipmentLines.length <= 500);
});

async function httpStaffLogin(targetApp: any, email: string, password: string) {
  let r = await inject(targetApp, { url: "/api/v1/session" });
  let cookie = r.headers["set-cookie"][0].split(";")[0];
  r = await inject(targetApp, {
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { cookie, "x-csrf-token": r.body.csrf },
    body: { email, password },
  });
  assert.equal(r.status, 200);
  cookie = r.headers["set-cookie"][0].split(";")[0];
  r = await inject(targetApp, { url: "/api/v1/session", headers: { cookie } });
  return {
    cookie,
    "x-csrf-token": r.body.csrf,
    "x-company-context": "demo",
    "x-warehouse-context": "demo:legacy",
  };
}

test("staff provisioning & revocation lifecycle: end-to-end authorization", async () => {
  // 1. Check directory
  const dir = await inject(app, {
    url: "/api/v1/access/directory",
    headers: adminHeaders,
  });
  assert.equal(dir.status, 200);
  assert.ok(dir.body.members.length > 0);

  // 2. Provision new staff member with password
  const newEmail = "new-staff-" + uuid() + "@example.invalid";
  const newPassword = "SecretPassword123!";
  const provisionRes = await inject(app, {
    method: "POST",
    url: "/api/v1/access/staff",
    headers: adminHeaders,
    body: {
      clientOperationId: uuid(),
      email: newEmail,
      name: "New Staff Member",
      role: "operator",
      password: newPassword,
      warehouseId: "demo:legacy",
      reason: "Initial hiring for warehouse operations",
    },
  });
  assert.equal(provisionRes.status, 200);
  assert.equal(provisionRes.body.user.email, newEmail.toLowerCase());
  assert.equal(provisionRes.body.membership.role, "operator");
  assert.equal(provisionRes.body.grant.warehouse_id, "demo:legacy");
  assert.equal(provisionRes.body.isNew, true);

  // 3. Authenticate via standard auth login
  const staffSession = await httpStaffLogin(app, newEmail, newPassword);

  // 4. New staff member can read authorized workspace
  const staffWs = await inject(app, {
    url: "/api/v1/workspace",
    headers: staffSession,
  });
  assert.equal(staffWs.status, 200);

  // 5. Operator cannot configure company (forbidden)
  const forbiddenConfig = await inject(app, {
    method: "POST",
    url: "/api/v1/company-configuration",
    headers: staffSession,
    body: {
      clientOperationId: uuid(),
      expectedVersion: 1,
      section: "identity",
      displayName: "Should fail",
      operatingProfile: "general",
      reason: "Unauthorized attempt",
    },
  });
  assert.equal(forbiddenConfig.status, 403);

  // 6. Administrator revokes staff membership
  const revokeRes = await inject(app, {
    method: "POST",
    url: "/api/v1/access/memberships",
    headers: adminHeaders,
    body: {
      clientOperationId: uuid(),
      email: newEmail,
      expectedVersion: provisionRes.body.membership.version,
      role: "operator",
      active: false,
      reason: "End of seasonal contract",
    },
  });
  assert.equal(revokeRes.status, 200);
  assert.equal(revokeRes.body.active, false);

  // 7. Revoked staff member is immediately blocked on session/command
  const revokedAttempt = await inject(app, {
    method: "POST",
    url: "/api/v1/receipts",
    headers: staffSession,
    body: {
      clientOperationId: uuid(),
      customerId: null,
      locationId: "loc-stage",
      sourceLabel: "REVOKED-TEST",
      condition: "good",
      contents: [],
    },
  });
  assert.equal(revokedAttempt.status, 401);
  assert.equal(revokedAttempt.body.error.code, "UNAUTHENTICATED");

  // 8. Last administrator invariant is protected
  const removeAdminRes = await inject(app, {
    method: "POST",
    url: "/api/v1/access/memberships",
    headers: adminHeaders,
    body: {
      clientOperationId: uuid(),
      email: "demo@example.invalid",
      expectedVersion: 1,
      role: "administrator",
      active: false,
      reason: "Attempt to remove sole admin",
    },
  });
  assert.equal(removeAdminRes.status, 422);
  assert.equal(removeAdminRes.body.error.code, "LAST_ADMINISTRATOR");
});

