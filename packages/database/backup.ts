import type { DB } from "./index.js";
import { mkdir, readFile, writeFile, copyFile, mkdtemp, rm, constants } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
export const backupTables = [
  "organizations",
  "users",
  "warehouses",
  "company_memberships",
  "warehouse_grants",
  "customers",
  "destinations",
  "products",
  "lots",
  "locations",
  "pallets",
  "boxes",
  "contents",
  "orders",
  "order_lines",
  "allocations",
  "preparations",
  "preparation_orders",
  "trips",
  "stops",
  "shipments",
  "shipment_lines",
  "documents",
  "issues",
  "inventory_events",
  "operations",
  "jobs",
  "tracking_marks",
  "counts",
  "count_observations",
  "destination_authorizations",
  "company_configuration",
  "company_configuration_revisions",
  "product_imports",
  "product_import_items",
  "pallet_groups",
  "pallet_group_memberships",
  "suppliers",
  "expected_receipts",
  "expected_receipt_boxes",
];
export const p1Tables = [
  "stock_owners",
  "product_unit_conversions",
  "inventory_balances",
  "inventory_ledger",
  "purchase_orders",
  "purchase_order_lines",
  "inbound_discrepancies",
  "supplier_returns",
  "warehouse_tasks",
  "location_replenishment_policies",
  "transfer_orders",
  "transfer_lines",
  "csv_imports",
  "csv_import_errors",
  "warehouse_onboarding",
  "policy_snapshots",
];
// Logical backups include domain/configuration records, not expiring sessions.
export async function snapshot(db: DB) {
  return db.transaction(async (t) => {
    if (t.native) await t.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const existingTables = new Set(
      (await t.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map((r: any) => r.table_name)
    );
    const data: Record<string, any[]> = {};
    for (const table of backupTables)
      data[table] = (await t.query("SELECT * FROM " + table)).rows;
    for (const table of p1Tables) {
      if (existingTables.has(table)) {
        data[table] = (await t.query("SELECT * FROM " + table)).rows;
      }
    }
    return { format: "jadesun-v6", createdAt: new Date().toISOString(), tables: data };
  });
}
function validateBackup(backup: any) {
  if (!backup || !["jadesun-v1", "jadesun-v2", "jadesun-v3", "jadesun-v4", "jadesun-v5", "jadesun-v6"].includes(backup.format) || !backup.tables)
    throw new Error("Unsupported backup format");
  if (p1Tables.some((t) => backup.tables[t] !== undefined) && !p1Tables.every((t) => Array.isArray(backup.tables[t])))
    throw new Error("Incomplete P1 foundation backup tables");
  const groupTables = ["pallet_groups", "pallet_group_memberships"];
  const inboundTables = ["suppliers", "expected_receipts", "expected_receipt_boxes"];
  if (inboundTables.some((t) => backup.tables[t] !== undefined) && !inboundTables.every((t) => Array.isArray(backup.tables[t])))
    throw new Error("Incomplete inbound backup tables");
  if (groupTables.some((t) => backup.tables[t] !== undefined) && !groupTables.every((t) => Array.isArray(backup.tables[t])))
    throw new Error("Incomplete pallet group backup tables");
  const importTables = ["product_imports", "product_import_items"];
  if (importTables.some((t) => backup.tables[t] !== undefined) && !importTables.every((t) => Array.isArray(backup.tables[t])))
    throw new Error("Incomplete import backup tables");
  const newTables = ["warehouses", "company_memberships", "warehouse_grants"];
  if (newTables.some((t) => backup.tables[t] !== undefined) && !newTables.every((t) => Array.isArray(backup.tables[t])))
    throw new Error("Incomplete access backup tables");
  for (const table of backupTables) {
    if (backup.format !== "jadesun-v6" && inboundTables.includes(table) && backup.tables[table] === undefined) continue;
    if (!["jadesun-v5", "jadesun-v6"].includes(backup.format) && groupTables.includes(table) && backup.tables[table] === undefined) continue;
    if (!["jadesun-v4", "jadesun-v5", "jadesun-v6"].includes(backup.format) && importTables.includes(table) && backup.tables[table] === undefined) continue;
    if (!["jadesun-v3", "jadesun-v4", "jadesun-v5", "jadesun-v6"].includes(backup.format) && newTables.includes(table) && backup.tables[table] === undefined) continue;
    if (backup.format === "jadesun-v1" && ["company_configuration", "company_configuration_revisions"].includes(table) && backup.tables[table] === undefined) continue;
    if (!Array.isArray(backup.tables[table]))
      throw new Error("Missing backup table: " + table);
    for (const row of backup.tables[table])
      if (!row || typeof row !== "object" || Array.isArray(row) || !Object.keys(row).length)
        throw new Error("Invalid backup record");
  }
}
async function insertSnapshot(t: DB, backup: any) {
  // Local transaction flag suppresses compatibility bootstraps only for complete dimension backups.
  // It is not an authorization context and cannot leak to another pooled transaction.
  await t.query("SELECT set_config('warehouse.restoring',$1,true)", [backup.tables.warehouses ? "true" : "false"]);
  const allTables = [...backupTables, ...p1Tables];
  for (const table of allTables) {
    if (!backup.tables[table]) continue;
    const columns = new Map(
      (
        await t.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name=$1 AND table_schema=$2", [table, "public"])
      ).rows.map((r) => [r.column_name, r.data_type]),
    );
    for (const row of backup.tables[table] || []) {
      const keys = Object.keys(row);
      if (keys.some((k) => !columns.has(k))) throw new Error("Unexpected backup column");
      const params = keys.map((k) => (row[k] !== null && ["json", "jsonb"].includes(columns.get(k)) ? JSON.stringify(row[k]) : row[k]));
      await t.query(`INSERT INTO ${table}(${keys.map((k) => '"' + k + '"').join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")})`, params);
    }
  }
}
async function requireEmpty(t: DB) {
  // Native locks prevent another writer from racing the empty-target check.
  if (t.native) await t.query("LOCK TABLE " + backupTables.join(",") + " IN ACCESS EXCLUSIVE MODE");
  const existingTables = new Set(
    (await t.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map((r: any) => r.table_name)
  );
  for (const table of backupTables) {
    if (existingTables.has(table) && (await t.query("SELECT 1 FROM " + table + " LIMIT 1")).rows.length)
      throw new Error("Restore target must be empty");
  }
  for (const table of p1Tables) {
    if (existingTables.has(table) && (await t.query("SELECT 1 FROM " + table + " LIMIT 1")).rows.length)
      throw new Error("Restore target must be empty");
  }
}
async function restoreConfigurationDefaults(t:DB) {
  await t.query("INSERT INTO company_configuration(org_id,display_name) SELECT id,name FROM organizations WHERE id NOT IN (SELECT org_id FROM company_configuration)");
}
export async function restoreSnapshot(db: DB, backup: any) {
  validateBackup(backup);
  await db.transaction(async (t) => {
    await requireEmpty(t);
    await insertSnapshot(t, backup);
    await restoreConfigurationDefaults(t);
  });
}
function fileKey(d: any) {
  if (typeof d.storage_key !== "string" || !/^[a-f0-9-]+$/.test(d.storage_key))
    throw new Error("Invalid storage key");
  return d.storage_key;
}
async function checkedFile(root: string, d: any) {
  const bytes = await readFile(path.join(root, fileKey(d)));
  if (bytes.length !== d.size || createHash("sha256").update(bytes).digest("hex") !== d.sha256)
    throw new Error("File integrity check failed");
  return bytes;
}
export async function writeBackup(db: DB, filename: string, uploads = "runtime/private") {
  const backup = await snapshot(db);
  await mkdir(path.dirname(filename), { recursive: true });
  // Exclusive creation never replaces an earlier recovery point.
  const fileDir = filename + ".files";
  await mkdir(fileDir, { mode: 0o700 });
  try {
    for (const d of backup.tables.documents)
      await writeFile(path.join(fileDir, fileKey(d)), await checkedFile(uploads, d), { mode: 0o600, flag: "wx" });
    await writeFile(filename, JSON.stringify(backup, null, 2), { mode: 0o600, flag: "wx" });
  } catch (e) {
    await rm(fileDir, { recursive: true, force: true });
    throw e;
  }
  return filename;
}
export async function restoreBackup(db: DB, filename: string, uploads = "runtime/private") {
  const backup = JSON.parse(await readFile(filename, "utf8"));
  validateBackup(backup);
  // Read/check all evidence before publishing anything; use a private staging directory.
  await mkdir(path.dirname(path.resolve(uploads)), { recursive: true });
  const stage = await mkdtemp(path.join(path.dirname(path.resolve(uploads)), ".restore-"));
  let ownsTarget = false;
  try {
    for (const d of backup.tables.documents)
      await writeFile(path.join(stage, fileKey(d)), await checkedFile(filename + ".files", d), { mode: 0o600, flag: "wx" });
    await db.transaction(async t => {
      await requireEmpty(t);
      await insertSnapshot(t, backup);
      await restoreConfigurationDefaults(t);
      // Existing targets, even empty directories, are deliberately refused.
      await mkdir(uploads, { mode: 0o700 });
      ownsTarget = true;
      for (const d of backup.tables.documents)
        await copyFile(path.join(stage, fileKey(d)), path.join(uploads, fileKey(d)), constants.COPYFILE_EXCL);
    });
  } catch (e) {
    if (ownsTarget) await rm(uploads, { recursive: true, force: true });
    throw e;
  } finally { await rm(stage, { recursive: true, force: true }); }
}
