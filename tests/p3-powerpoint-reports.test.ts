import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID as uuid } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { openDatabase, migrate, type DB } from "../packages/database/index.js";
import { seed } from "../packages/database/seed.js";
import { createApp } from "../apps/api/app.js";
import { inject } from "./inject.js";
import * as zlib from "node:zlib";
import { getOperationsReportData, exportOperationsPptx } from "../packages/domain/reports.js";
import { generateOperationsPptx } from "../packages/domain/pptx-generator.js";

function readZipFile(zipBuf: Buffer, filePath: string): string | null {
  let offset = 0;
  while (offset < zipBuf.length - 30) {
    const sig = zipBuf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = zipBuf.readUInt16LE(offset + 8);
    const compSize = zipBuf.readUInt32LE(offset + 18);
    const nameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const name = zipBuf.toString("utf8", offset + 30, offset + 30 + nameLen);
    const dataStart = offset + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (name === filePath) {
      const slice = zipBuf.subarray(dataStart, dataEnd);
      return method === 8 ? zlib.inflateRawSync(slice).toString("utf8") : slice.toString("utf8");
    }
    offset = dataEnd;
  }
  return null;
}

let db: DB;
let app: any;
let uploadsDir: string;
let adminHeaders: Record<string, string>;
let operatorHeaders: Record<string, string>;
let driverHeaders: Record<string, string>;
let secondCompanyHeaders: Record<string, string>;

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
  uploadsDir = await mkdtemp(path.join(os.tmpdir(), "jadesun-p3-reports-test-"));
  db = await openDatabase(null, ":memory:");
  await migrate(db);
  await seed(db);
  app = createApp(db, { uploads: uploadsDir, demo: true });

  adminHeaders = await httpSession(app, "demo-admin");
  operatorHeaders = await httpSession(app, "demo-operator");
  driverHeaders = await httpSession(app, "demo-driver");

  // Seed company-2 for isolation verification
  const bcrypt = (await import("bcryptjs")).default;
  const hash = await bcrypt.hash("Password123!", 4);

  await db.query(
    "INSERT INTO organizations (id, name, demo) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    ["company-2", "Second Company Ltd", false]
  );
  await db.query(
    "INSERT INTO company_configuration (org_id, display_name, timezone, language, date_format) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
    ["company-2", "Second Company Ltd", "UTC", "en", "iso"]
  );
  await db.query(
    "INSERT INTO warehouses (id, org_id, code, name, address, active) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
    ["wh-2", "company-2", "WH2", "Second Warehouse", "456 Secondary Rd", true]
  );
  await db.query(
    "INSERT INTO users (id, org_id, name, email, password_hash, role, active) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING",
    ["user-comp2", "company-2", "Comp2 Admin", "admin@comp2.test", hash, "administrator", true]
  );
  await db.query(
    "INSERT INTO company_memberships (user_id, org_id, role, active) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
    ["user-comp2", "company-2", "administrator", true]
  );
  await db.query(
    "INSERT INTO warehouse_grants (user_id, org_id, warehouse_id, active) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
    ["user-comp2", "company-2", "wh-2", true]
  );

  let r = await inject(app, { url: "/api/v1/session" });
  let cookie = r.headers["set-cookie"][0].split(";")[0];
  r = await inject(app, {
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { cookie, "x-csrf-token": r.body.csrf },
    body: { email: "admin@comp2.test", password: "Password123!" },
  });
  assert.equal(r.status, 200);
  cookie = r.headers["set-cookie"][0].split(";")[0];
  r = await inject(app, { url: "/api/v1/session", headers: { cookie } });

  const switched = await inject(app, {
    method: "POST",
    url: "/api/v1/auth/context",
    headers: { cookie, "x-csrf-token": r.body.csrf },
    body: { companyId: "company-2", warehouseId: "wh-2" },
  });
  assert.equal(switched.status, 200);
  cookie = switched.headers["set-cookie"][0].split(";")[0];
  const c2Session = await inject(app, { url: "/api/v1/session", headers: { cookie } });

  secondCompanyHeaders = {
    cookie,
    "x-csrf-token": c2Session.body.csrf,
    "x-company-context": "company-2",
    "x-warehouse-context": "wh-2",
  };
});

after(async () => {
  await db.close();
  await rm(uploadsDir, { recursive: true, force: true });
});

test("P3.1 Operations Report Data: aggregates real inbound, picking, inventory, quality and task metrics", async () => {
  const res = await inject(app, {
    method: "GET",
    url: "/api/v1/reports/operations/data",
    headers: adminHeaders,
  });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);

  const data = res.body.data;
  assert.equal(data.company.id, "demo");
  assert.equal(data.warehouse.id, "demo:legacy");

  // Inbound structure
  assert.equal(typeof data.inbound.purchaseOrdersCount, "number");
  assert.equal(typeof data.inbound.totalExpectedUnits, "string");
  assert.equal(typeof data.inbound.receivedBoxesCount, "number");
  assert.equal(typeof data.inbound.discrepanciesCount, "number");
  assert.equal(typeof data.inbound.discrepancyBreakdown.damaged, "number");
  assert.equal(typeof data.inbound.discrepancyBreakdown.short, "number");
  assert.equal(typeof data.inbound.discrepancyBreakdown.over, "number");
  assert.equal(typeof data.inbound.discrepancyBreakdown.unexpected, "number");

  // Picking structure
  assert.equal(typeof data.picking.totalPicksVerified, "number");
  assert.equal(typeof data.picking.totalUnitsPicked, "string");
  assert.equal(typeof data.picking.shortagePicksCount, "number");
  assert.equal(typeof data.picking.substitutionsCount, "number");
  assert.equal(typeof data.picking.totesDispatchedCount, "number");

  // Inventory structure
  assert.equal(typeof data.inventory.totalOnHandQuantity, "string");
  assert.equal(typeof data.inventory.totalReservedQuantity, "string");
  assert.equal(typeof data.inventory.totalAvailableQuantity, "string");
  assert.equal(typeof data.inventory.totalHeldQuantity, "string");
  assert.ok(Array.isArray(data.inventory.stockOwners));

  // Quality structure
  assert.equal(typeof data.quality.activeHoldsCount, "number");
  assert.equal(typeof data.quality.holdSeverityBreakdown.critical, "number");
  assert.equal(typeof data.quality.holdSeverityBreakdown.major, "number");
  assert.equal(typeof data.quality.holdSeverityBreakdown.minor, "number");
  assert.equal(typeof data.quality.quarantinedLotsCount, "number");
  assert.equal(typeof data.quality.quarantinedSerialsCount, "number");

  // Task backlog structure
  assert.equal(typeof data.tasks.openTasksCount, "number");
  assert.equal(typeof data.tasks.claimedTasksCount, "number");
  assert.equal(typeof data.tasks.blockedTasksCount, "number");
  assert.equal(typeof data.tasks.urgentPriorityCount, "number");
});

test("P3.2 PowerPoint Presentation Generation (.pptx): valid Open Packaging Conventions ZIP and PresentationML structure", async () => {
  const res = await inject(app, {
    method: "GET",
    url: "/api/v1/reports/operations/pptx",
    headers: adminHeaders,
    binary: true,
  });

  assert.equal(res.status, 200);
  assert.ok(
    res.headers["content-type"].includes(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
  );
  assert.ok(res.headers["content-disposition"].includes(".pptx"));

  const rawBuffer = res.raw;
  assert.ok(Buffer.isBuffer(rawBuffer));
  assert.ok(rawBuffer.length > 2000, `Buffer size ${rawBuffer.length} should be > 2000 bytes`);

  // Verify ZIP magic bytes PK\x03\x04
  assert.equal(rawBuffer[0], 0x50);
  assert.equal(rawBuffer[1], 0x4b);
  assert.equal(rawBuffer[2], 0x03);
  assert.equal(rawBuffer[3], 0x04);

  // Verify internal PresentationML manifest and slide entries exist in raw zip
  const str = rawBuffer.toString("binary");
  assert.ok(str.includes("[Content_Types].xml"), "Must contain [Content_Types].xml");
  assert.ok(str.includes("ppt/presentation.xml"), "Must contain ppt/presentation.xml");
  assert.ok(str.includes("ppt/slides/slide1.xml"), "Must contain slide1.xml");
  assert.ok(str.includes("ppt/slides/slide2.xml"), "Must contain slide2.xml");
  assert.ok(str.includes("ppt/slides/slide3.xml"), "Must contain slide3.xml");
  assert.ok(str.includes("ppt/slides/slide4.xml"), "Must contain slide4.xml");
  assert.ok(str.includes("ppt/slides/slide5.xml"), "Must contain slide5.xml");
  assert.ok(str.includes("ppt/slides/slide6.xml"), "Must contain slide6.xml");
  assert.ok(str.includes("ppt/theme/theme1.xml"), "Must contain theme1.xml");
  assert.ok(str.includes("ppt/slideMasters/slideMaster1.xml"), "Must contain slideMaster1.xml");

  // Verify unpacked contents
  const themeXml = readZipFile(rawBuffer, "ppt/theme/theme1.xml");
  assert.ok(themeXml?.includes("SyntheticDark"), "Theme XML must contain SyntheticDark");
  assert.ok(themeXml?.includes("0F172A"), "Theme XML must contain slate-900 background #0F172A");
  assert.ok(themeXml?.includes("6366F1"), "Theme XML must contain indigo accent #6366F1");

  const slide1Xml = readZipFile(rawBuffer, "ppt/slides/slide1.xml");
  assert.ok(slide1Xml?.includes("Warehouse Floor Operations"), "Slide 1 must contain title");
  assert.ok(slide1Xml?.includes("Shift Supervisor Briefing Deck"), "Slide 1 must contain subtitle");
});

test("P3.3 Multi-Tenant Isolation: second company cannot access first company report data or presentation", async () => {
  const res = await inject(app, {
    method: "GET",
    url: "/api/v1/reports/operations/data",
    headers: secondCompanyHeaders,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);

  const data = res.body.data;
  assert.equal(data.company.id, "company-2");
  assert.equal(data.warehouse.id, "wh-2");

  // Second company has 0 of first company's POs or picks
  assert.equal(data.inbound.purchaseOrdersCount, 0);
  assert.equal(data.picking.totalPicksVerified, 0);
  assert.equal(data.quality.activeHoldsCount, 0);

  // PowerPoint generated for second company also has second company scope
  const pptxRes = await inject(app, {
    method: "GET",
    url: "/api/v1/reports/operations/pptx",
    headers: secondCompanyHeaders,
    binary: true,
  });
  assert.equal(pptxRes.status, 200);
  const secondSlide1 = readZipFile(pptxRes.raw, "ppt/slides/slide1.xml");
  assert.ok(secondSlide1?.includes("WH2"), "Second company slide 1 must contain its warehouse code WH2");
});

test("P3.4 Role Authorization: operator and driver roles fail closed with 403 FORBIDDEN", async () => {
  // Operator blocked from report data
  const opData = await inject(app, {
    method: "GET",
    url: "/api/v1/reports/operations/data",
    headers: operatorHeaders,
  });
  assert.equal(opData.status, 403);
  assert.equal(opData.body.error?.code, "FORBIDDEN");

  // Driver blocked from PPTX presentation download
  const driverPptx = await inject(app, {
    method: "GET",
    url: "/api/v1/reports/operations/pptx",
    headers: driverHeaders,
  });
  assert.equal(driverPptx.status, 403);
  assert.equal(driverPptx.body.error?.code, "FORBIDDEN");

  // Unauthenticated blocked
  const unauth = await inject(app, {
    method: "GET",
    url: "/api/v1/reports/operations/data",
  });
  assert.equal(unauth.status, 401);
});

test("P3.5 Direct Domain Unit Tests: getOperationsReportData and generateOperationsPptx", async () => {
  const data = await getOperationsReportData(db, supervisorActor, { startDate: "2026-01-01", endDate: "2026-12-31" });
  assert.equal(data.company.id, "demo");
  assert.equal(data.dateRange.startDate, "2026-01-01");
  assert.equal(data.dateRange.endDate, "2026-12-31");

  // Generate presentation buffer directly
  const buf = generateOperationsPptx(data);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 2000);
  assert.equal(buf[0], 0x50);
  assert.equal(buf[1], 0x4b);

  // Operator actor calling domain function directly throws FORBIDDEN
  await assert.rejects(
    async () => {
      await getOperationsReportData(db, operatorActor);
    },
    { code: "FORBIDDEN" }
  );

  // Actor missing warehouse context throws WAREHOUSE_REQUIRED
  await assert.rejects(
    async () => {
      await getOperationsReportData(db, { ...supervisorActor, warehouse_id: "" as any });
    },
    { code: "WAREHOUSE_REQUIRED" }
  );
});
