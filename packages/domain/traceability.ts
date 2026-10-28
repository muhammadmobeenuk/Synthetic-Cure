import { randomUUID as uuid } from "node:crypto";
import Decimal from "decimal.js";
import type { DB } from "../database/index.js";
import { type Actor, requireRule } from "./index.js";
import { owned, version, event, command } from "./services.js";
import type {
  QualityHoldCreate,
  QualityHoldRelease,
  RecallInitiate,
  RecallClose,
  SerialRegister,
} from "../contracts/traceability.js";

// Helper: Neutralize formula injection in CSV exports
export function escapeCsvCell(val: any): string {
  if (val === null || val === undefined) return "";
  let str = String(val);
  // Neutralize formula triggers: =, +, -, @, tab, carriage return
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

export async function isQualityHeld(
  t: DB,
  orgId: string,
  warehouseId: string,
  target: {
    productId?: string | null;
    lotId?: string | null;
    boxId?: string | null;
    serialNumber?: string | null;
    locationId?: string | null;
  },
): Promise<{ held: boolean; hold?: any }> {
  const clauses: string[] = [];
  const params: any[] = [orgId, warehouseId];

  if (target.productId) {
    params.push(target.productId);
    clauses.push(`(scope = 'product' AND target_id = $${params.length})`);
  }
  if (target.lotId) {
    params.push(target.lotId);
    clauses.push(`(scope = 'lot' AND target_id = $${params.length})`);
  }
  if (target.boxId) {
    params.push(target.boxId);
    clauses.push(`(scope = 'box' AND target_id = $${params.length})`);
  }
  if (target.serialNumber) {
    params.push(target.serialNumber);
    clauses.push(`(scope = 'serial' AND target_id = $${params.length})`);
  }
  if (target.locationId) {
    params.push(target.locationId);
    clauses.push(`(scope = 'location' AND target_id = $${params.length})`);
  }

  if (clauses.length === 0) return { held: false };

  const query = `
    SELECT * FROM quality_holds
    WHERE org_id = $1 AND warehouse_id = $2 AND status = 'active'
      AND (${clauses.join(" OR ")})
    LIMIT 1
  `;
  const res = await t.query(query, params);
  if (res.rows.length > 0) {
    return { held: true, hold: res.rows[0] };
  }
  return { held: false };
}

export async function listQualityHolds(
  db: DB,
  actor: Actor,
  filters: { status?: string; scope?: string; targetId?: string; limit?: number; offset?: number },
) {
  const warehouseId = actor.warehouse_id || `${actor.org_id}:legacy`;
  const conditions = ["org_id = $1", "warehouse_id = $2"];
  const params: any[] = [actor.org_id, warehouseId];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.scope) {
    params.push(filters.scope);
    conditions.push(`scope = $${params.length}`);
  }
  if (filters.targetId) {
    params.push(filters.targetId);
    conditions.push(`target_id = $${params.length}`);
  }

  const limit = Math.min(filters.limit || 50, 100);
  const offset = filters.offset || 0;
  params.push(limit, offset);

  const query = `
    SELECT * FROM quality_holds
    WHERE ${conditions.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;
  const res = await db.query(query, params);
  return res.rows;
}

export async function createQualityHold(
  db: DB,
  actor: Actor,
  input: QualityHoldCreate,
) {
  requireRule(
    actor.role === "admin" || actor.role === "administrator" || actor.role === "supervisor",
    "UNAUTHORIZED",
    "Only supervisors or administrators can place quality quarantine holds",
    403,
  );
  const warehouseId = actor.warehouse_id || `${actor.org_id}:legacy`;

  return command(db, actor, "quality_holds.create", input, async (t) => {
      // 1. Validate target existence based on scope
      if (input.scope === "product") {
        const prod = await t.query("SELECT id FROM products WHERE id = $1 AND org_id = $2", [
          input.targetId,
          actor.org_id,
        ]);
        requireRule(prod.rows.length > 0, "NOT_FOUND", "Product not found", 404);
      } else if (input.scope === "lot") {
        const lot = await t.query("SELECT id FROM lots WHERE id = $1 AND org_id = $2", [
          input.targetId,
          actor.org_id,
        ]);
        requireRule(lot.rows.length > 0, "NOT_FOUND", "Lot not found", 404);
      } else if (input.scope === "box") {
        const box = await t.query("SELECT id FROM boxes WHERE id = $1 AND org_id = $2", [
          input.targetId,
          actor.org_id,
        ]);
        requireRule(box.rows.length > 0, "NOT_FOUND", "Box not found", 404);
      } else if (input.scope === "location") {
        const loc = await t.query("SELECT id FROM locations WHERE id = $1 AND org_id = $2", [
          input.targetId,
          actor.org_id,
        ]);
        requireRule(loc.rows.length > 0, "NOT_FOUND", "Location not found", 404);
      }

      // 2. Prevent duplicate active hold on the same scope + target
      const existing = await t.query(
        "SELECT id FROM quality_holds WHERE org_id = $1 AND warehouse_id = $2 AND scope = $3 AND target_id = $4 AND status = 'active'",
        [actor.org_id, warehouseId, input.scope, input.targetId],
      );
      requireRule(existing.rows.length === 0, "HOLD_EXISTS", "An active quality hold already exists for this target", 409);

      // 3. Create hold
      const holdId = uuid();
      const insertQuery = `
        INSERT INTO quality_holds(id, org_id, warehouse_id, scope, target_id, reason, severity, status, authorized_by, version)
        VALUES($1, $2, $3, $4, $5, $6, $7, 'active', $8, 1)
        RETURNING *
      `;
      const hold = (
        await t.query(insertQuery, [
          holdId,
          actor.org_id,
          warehouseId,
          input.scope,
          input.targetId,
          input.reason,
          input.severity,
          actor.id,
        ])
      ).rows[0];

      // 4. Update underlying entities if applicable
      if (input.scope === "box") {
        await t.query("UPDATE boxes SET condition = 'hold', version = version + 1 WHERE id = $1", [input.targetId]);
      } else if (input.scope === "lot") {
        await t.query("UPDATE lots SET quality_status = 'quarantine' WHERE id = $1", [input.targetId]);
      } else if (input.scope === "serial") {
        await t.query(
          "UPDATE item_serials SET status = 'quarantined', quarantine_hold_id = $1, updated_at = now() WHERE org_id = $2 AND serial_number = $3",
          [holdId, actor.org_id, input.targetId],
        );
      }

      // 5. Append-only audit event
      await event(t, actor, holdId, "quality_hold.created", {
        holdId,
        scope: input.scope,
        targetId: input.targetId,
        reason: input.reason,
        severity: input.severity,
      });

      return hold;
    });
}

export async function releaseQualityHold(
  db: DB,
  actor: Actor,
  holdId: string,
  input: QualityHoldRelease,
) {
  requireRule(
    actor.role === "admin" || actor.role === "administrator" || actor.role === "supervisor",
    "UNAUTHORIZED",
    "Only supervisors or administrators can release quality quarantine holds",
    403,
  );
  const warehouseId = actor.warehouse_id || `${actor.org_id}:legacy`;

  return command(db, actor, "quality_holds.release", input, async (t) => {
    const hold = await owned(t, "quality_holds", holdId, actor, true);
      version(hold, input.expectedVersion);
      requireRule(hold.status === "active", "HOLD_RELEASED", "Quality hold is already released", 422);

      const updateQuery = `
        UPDATE quality_holds
        SET status = 'released',
            released_by = $1,
            released_at = now(),
            release_reason = $2,
            disposition = $3,
            version = version + 1
        WHERE id = $4
        RETURNING *
      `;
      const released = (
        await t.query(updateQuery, [
          actor.id,
          input.releaseReason,
          input.disposition || null,
          holdId,
        ])
      ).rows[0];

      // Revert underlying state where safe
      if (hold.scope === "box" && input.disposition === "release_as_is") {
        await t.query("UPDATE boxes SET condition = 'good', version = version + 1 WHERE id = $1", [hold.target_id]);
      } else if (hold.scope === "lot" && input.disposition === "release_as_is") {
        const otherHolds = await t.query(
          "SELECT id FROM quality_holds WHERE org_id = $1 AND warehouse_id = $2 AND scope = 'lot' AND target_id = $3 AND status = 'active'",
          [actor.org_id, warehouseId, hold.target_id],
        );
        if (otherHolds.rows.length === 0) {
          await t.query("UPDATE lots SET quality_status = 'released' WHERE id = $1", [hold.target_id]);
        }
      } else if (hold.scope === "serial") {
        const newStatus = input.disposition === "scrap" ? "scrapped" : "stored";
        await t.query(
          "UPDATE item_serials SET status = $1, quarantine_hold_id = NULL, updated_at = now() WHERE org_id = $2 AND serial_number = $3",
          [newStatus, actor.org_id, hold.target_id],
        );
      }

      await event(t, actor, holdId, "quality_hold.released", {
        holdId,
        scope: hold.scope,
        targetId: hold.target_id,
        releaseReason: input.releaseReason,
        disposition: input.disposition,
      });

      return released;
    });
}

// =========================================================================
// Recalls and Impact Analysis
// =========================================================================

export async function initiateRecall(
  db: DB,
  actor: Actor,
  input: RecallInitiate,
) {
  requireRule(
    actor.role === "admin" || actor.role === "administrator" || actor.role === "supervisor",
    "UNAUTHORIZED",
    "Only supervisors or administrators can initiate product recalls",
    403,
  );
  const warehouseId = actor.warehouse_id || `${actor.org_id}:legacy`;

  return command(db, actor, "recalls.initiate", input, async (t) => {
    // 1. Verify code uniqueness
      const existing = await t.query(
        "SELECT id FROM recalls WHERE org_id = $1 AND code = $2",
        [actor.org_id, input.code],
      );
      requireRule(existing.rows.length === 0, "RECALL_EXISTS", "A recall with this code already exists", 409);

      // 2. Verify product
      const prodRes = await t.query("SELECT * FROM products WHERE id = $1 AND org_id = $2", [
        input.productId,
        actor.org_id,
      ]);
      requireRule(prodRes.rows.length > 0, "NOT_FOUND", "Product not found", 404);
      const product = prodRes.rows[0];

      // 3. Atomically create product quarantine hold
      const holdId = uuid();
      await t.query(
        `INSERT INTO quality_holds(id, org_id, warehouse_id, scope, target_id, reason, severity, status, authorized_by, version)
         VALUES($1, $2, $3, 'product', $4, $5, 'critical', 'active', $6, 1)`,
        [
          holdId,
          actor.org_id,
          warehouseId,
          input.productId,
          `MANDATORY RECALL [${input.code}]: ${input.title} - ${input.reason}`,
          actor.id,
        ],
      );

      // Also place lot hold if specified
      if (input.lotId) {
        await t.query(
          `INSERT INTO quality_holds(id, org_id, warehouse_id, scope, target_id, reason, severity, status, authorized_by, version)
           VALUES($1, $2, $3, 'lot', $4, $5, 'critical', 'active', $6, 1)`,
          [
            uuid(),
            actor.org_id,
            warehouseId,
            input.lotId,
            `MANDATORY RECALL LOT HOLD [${input.code}]: ${input.title}`,
            actor.id,
          ],
        );
        await t.query("UPDATE lots SET quality_status = 'recalled' WHERE id = $1", [input.lotId]);
      }

      // 4. Mark all matching on-hand boxes as condition = 'hold'
      let boxQuery = `
        SELECT DISTINCT b.id
        FROM boxes b
        JOIN contents c ON c.box_id = b.id AND c.product_id = $1
        WHERE b.org_id = $2 AND b.status IN ('stored', 'unconfirmed')
      `;
      const boxParams: any[] = [input.productId, actor.org_id];
      if (input.lotId) {
        boxQuery += " AND c.lot_id = $3";
        boxParams.push(input.lotId);
      }
      const onHandBoxes = (await t.query(boxQuery, boxParams)).rows;

      if (onHandBoxes.length > 0) {
        const boxIds = onHandBoxes.map((b) => b.id);
        await t.query(
          `UPDATE boxes SET condition = 'hold', version = version + 1 WHERE id = ANY($1::text[])`,
          [boxIds],
        );
      }

      // 5. Query affected delivered/in-transit outbound shipment lines
      let outboundQuery = `
        SELECT DISTINCT sl.box_id
        FROM shipment_lines sl
        JOIN shipments s ON s.id = sl.shipment_id
        WHERE sl.org_id = $1 AND sl.product_id = $2
      `;
      const outboundParams: any[] = [actor.org_id, input.productId];
      if (input.lotId) {
        outboundQuery += ` AND sl.box_id IN (SELECT box_id FROM contents WHERE product_id = $2 AND lot_id = $3)`;
        outboundParams.push(input.lotId);
      }
      const outboundBoxes = (await t.query(outboundQuery, outboundParams)).rows;

      // 6. Create recall record
      const recallId = uuid();
      const insertRecall = `
        INSERT INTO recalls(
          id, org_id, warehouse_id, code, title, product_id, lot_id, reason, severity,
          status, quality_hold_id, affected_on_hand_boxes, affected_delivered_boxes,
          initiated_by, version
        )
        VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $11, $12, $13, 1)
        RETURNING *
      `;
      const recall = (
        await t.query(insertRecall, [
          recallId,
          actor.org_id,
          warehouseId,
          input.code,
          input.title,
          input.productId,
          input.lotId || null,
          input.reason,
          input.severity,
          holdId,
          onHandBoxes.length,
          outboundBoxes.length,
          actor.id,
        ])
      ).rows[0];

      await event(t, actor, recallId, "recall.initiated", {
        recallId,
        code: input.code,
        productId: input.productId,
        lotId: input.lotId,
        affectedOnHandBoxes: onHandBoxes.length,
        affectedDeliveredBoxes: outboundBoxes.length,
      });

      return recall;
    });
}

export async function closeRecall(
  db: DB,
  actor: Actor,
  recallId: string,
  input: RecallClose,
) {
  requireRule(
    actor.role === "admin" || actor.role === "administrator" || actor.role === "supervisor",
    "UNAUTHORIZED",
    "Only supervisors or administrators can close product recalls",
    403,
  );

  return command(db, actor, "recalls.close", input, async (t) => {
    const recall = await owned(t, "recalls", recallId, actor, true);
      version(recall, input.expectedVersion);
      requireRule(recall.status === "active", "RECALL_CLOSED", "Recall is already closed", 422);

      const updateQuery = `
        UPDATE recalls
        SET status = 'completed',
            closed_by = $1,
            closed_at = now(),
            closure_notes = $2,
            version = version + 1
        WHERE id = $3
        RETURNING *
      `;
      const closed = (await t.query(updateQuery, [actor.id, input.closureNotes, recallId])).rows[0];

      await event(t, actor, recallId, "recall.closed", {
        recallId,
        closureNotes: input.closureNotes,
      });

      return closed;
    });
}

export async function getRecallReport(db: DB, actor: Actor, recallId: string) {
  const recallRes = await db.query(
    `SELECT r.*, p.sku product_sku, p.name product_name, p.name_zh product_name_zh, p.unit product_unit,
            l.reference lot_reference, l.expires_on lot_expires_on, l.manufactured_on lot_manufactured_on
     FROM recalls r
     JOIN products p ON p.id = r.product_id
     LEFT JOIN lots l ON l.id = r.lot_id
     WHERE r.id = $1 AND r.org_id = $2`,
    [recallId, actor.org_id],
  );
  requireRule(recallRes.rows.length > 0, "NOT_FOUND", "Recall not found", 404);
  const recall = recallRes.rows[0];

  // 1. Quarantined on-hand boxes
  let onHandQuery = `
    SELECT b.id box_id, b.code box_code, b.condition, b.status,
           loc.code location_code, loc.name location_name,
           c.quantity, c.unit
    FROM boxes b
    JOIN contents c ON c.box_id = b.id AND c.product_id = $1
    LEFT JOIN locations loc ON loc.id = b.location_id
    WHERE b.org_id = $2 AND b.status IN ('stored', 'unconfirmed')
  `;
  const onHandParams: any[] = [recall.product_id, actor.org_id];
  if (recall.lot_id) {
    onHandQuery += " AND c.lot_id = $3";
    onHandParams.push(recall.lot_id);
  }
  const onHand = (await db.query(onHandQuery, onHandParams)).rows;

  // 2. Outbound Customer & Destination Impact
  let outboundQuery = `
    SELECT DISTINCT
      c.id customer_id, c.code customer_code, c.name customer_name, c.name_zh customer_name_zh,
      d.name destination_name, d.address destination_address,
      o.code order_code,
      s.id shipment_id, s.status shipment_status,
      sl.quantity shipped_quantity, sl.delivered delivered_quantity, sl.returned returned_quantity, sl.unit,
      t.code trip_code, t.business_date delivery_date,
      u.name driver_name
    FROM shipment_lines sl
    JOIN shipments s ON s.id = sl.shipment_id
    JOIN orders o ON o.id = s.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN destinations d ON d.id = s.destination_id
    LEFT JOIN trips t ON t.id = s.trip_id
    LEFT JOIN users u ON u.id = t.driver_id
    WHERE sl.org_id = $1 AND sl.product_id = $2
  `;
  const outboundParams: any[] = [actor.org_id, recall.product_id];
  if (recall.lot_id) {
    outboundQuery += ` AND sl.box_id IN (SELECT box_id FROM contents WHERE product_id = $2 AND lot_id = $3)`;
    outboundParams.push(recall.lot_id);
  }
  const outbound = (await db.query(outboundQuery, outboundParams)).rows;

  // 3. Quantitative Totals
  const totalOnHandQuantity = onHand.reduce((acc, r) => acc.plus(r.quantity || 0), new Decimal(0)).toString();
  const totalDeliveredQuantity = outbound.reduce((acc, r) => acc.plus(r.delivered_quantity || r.shipped_quantity || 0), new Decimal(0)).toString();
  const affectedCustomerCodes = Array.from(new Set(outbound.map((r) => r.customer_code)));

  return {
    recall,
    totals: {
      onHandBoxesCount: onHand.length,
      totalOnHandQuantity,
      outboundShipmentsCount: outbound.length,
      totalDeliveredQuantity,
      affectedCustomersCount: affectedCustomerCodes.length,
    },
    onHandInventory: onHand,
    outboundDistribution: outbound,
  };
}

export async function exportRecallCsv(db: DB, actor: Actor, recallId: string): Promise<string> {
  const report = await getRecallReport(db, actor, recallId);
  const lines: string[] = [];

  // Metadata Section
  lines.push(`RECALL DOSSIER · ${escapeCsvCell(report.recall.code)}`);
  lines.push(`Title,${escapeCsvCell(report.recall.title)}`);
  lines.push(`Product,${escapeCsvCell(report.recall.product_sku)} - ${escapeCsvCell(report.recall.product_name)}`);
  lines.push(`Severity,${escapeCsvCell(report.recall.severity)}`);
  lines.push(`Status,${escapeCsvCell(report.recall.status)}`);
  lines.push(`Reason,${escapeCsvCell(report.recall.reason)}`);
  lines.push(`Initiated At,${escapeCsvCell(report.recall.initiated_at)}`);
  lines.push("");

  // Executive Totals
  lines.push("EXECUTIVE TOTALS");
  lines.push(`Quarantined On-Hand Boxes,${report.totals.onHandBoxesCount}`);
  lines.push(`Quarantined On-Hand Quantity,${report.totals.totalOnHandQuantity} ${report.recall.product_unit}`);
  lines.push(`Outbound Shipments Affected,${report.totals.outboundShipmentsCount}`);
  lines.push(`Total Delivered to Customers,${report.totals.totalDeliveredQuantity} ${report.recall.product_unit}`);
  lines.push(`Distinct Customers Affected,${report.totals.affectedCustomersCount}`);
  lines.push("");

  // Outbound Impact Table
  lines.push("OUTBOUND CUSTOMER DISTRIBUTION IMPACT");
  lines.push("Customer Code,Customer Name,Destination,Address,Order Code,Trip Code,Delivery Date,Driver,Status,Delivered Qty,Unit");
  for (const item of report.outboundDistribution) {
    lines.push(
      [
        escapeCsvCell(item.customer_code),
        escapeCsvCell(item.customer_name),
        escapeCsvCell(item.destination_name),
        escapeCsvCell(item.destination_address),
        escapeCsvCell(item.order_code),
        escapeCsvCell(item.trip_code),
        escapeCsvCell(item.delivery_date),
        escapeCsvCell(item.driver_name),
        escapeCsvCell(item.shipment_status),
        escapeCsvCell(item.delivered_quantity),
        escapeCsvCell(item.unit),
      ].join(","),
    );
  }
  lines.push("");

  // Quarantined On-Hand Inventory Table
  lines.push("QUARANTINED ON-HAND INVENTORY");
  lines.push("Box Code,Location Code,Location Name,Condition,Status,Quantity,Unit");
  for (const item of report.onHandInventory) {
    lines.push(
      [
        escapeCsvCell(item.box_code),
        escapeCsvCell(item.location_code),
        escapeCsvCell(item.location_name),
        escapeCsvCell(item.condition),
        escapeCsvCell(item.status),
        escapeCsvCell(item.quantity),
        escapeCsvCell(item.unit),
      ].join(","),
    );
  }

  return lines.join("\r\n");
}

// =========================================================================
// Forward & Backward Traceability
// =========================================================================

export async function backwardTrace(
  db: DB,
  actor: Actor,
  criteria: { boxId?: string; boxCode?: string; orderId?: string },
) {
  let boxId = criteria.boxId;
  if (!boxId && criteria.boxCode) {
    const b = await db.query("SELECT id FROM boxes WHERE code = $1 AND org_id = $2", [
      criteria.boxCode,
      actor.org_id,
    ]);
    if (b.rows.length) boxId = b.rows[0].id;
  }

  // 1. Trace Box & Contents
  const boxRes = boxId
    ? await db.query(
        `SELECT b.*, loc.code location_code, p.code pallet_code
         FROM boxes b
         LEFT JOIN locations loc ON loc.id = b.location_id
         LEFT JOIN pallets p ON p.id = b.pallet_id
         WHERE b.id = $1 AND b.org_id = $2`,
        [boxId, actor.org_id],
      )
    : { rows: [] };
  const box = boxRes.rows[0] || null;

  const contents = boxId
    ? (
        await db.query(
          `SELECT c.*, pr.sku product_sku, pr.name product_name, l.reference lot_reference, l.expires_on, l.manufactured_on
           FROM contents c
           JOIN products pr ON pr.id = c.product_id
           LEFT JOIN lots l ON l.id = c.lot_id
           WHERE c.box_id = $1 AND c.org_id = $2`,
          [boxId, actor.org_id],
        )
      ).rows
    : [];

  // 2. Trace Inbound Provenance
  const inboundRes = boxId
    ? await db.query(
        `SELECT erb.*, er.reference expectation_reference, er.expected_date, s.code supplier_code, s.name supplier_name
         FROM expected_receipt_boxes erb
         JOIN expected_receipts er ON er.id = erb.expected_receipt_id
         JOIN suppliers s ON s.id = er.supplier_id
         WHERE erb.box_id = $1 AND erb.org_id = $2`,
        [boxId, actor.org_id],
      )
    : { rows: [] };

  // 3. Trace Outbound Allocations and Shipments
  const allocations = boxId
    ? (
        await db.query(
          `SELECT a.*, o.code order_code, c.name customer_name, d.name destination_name
           FROM allocations a
           JOIN orders o ON o.id = a.order_id
           JOIN customers c ON c.id = o.customer_id
           JOIN destinations d ON d.id = o.destination_id
           WHERE a.box_id = $1 AND a.org_id = $2`,
          [boxId, actor.org_id],
        )
      ).rows
    : [];

  // 4. Trace Active Quality Holds
  const qualityHoldCheck = boxId
    ? await isQualityHeld(db, actor.org_id, actor.warehouse_id || `${actor.org_id}:legacy`, {
        boxId,
        productId: contents[0]?.product_id,
        lotId: contents[0]?.lot_id,
      })
    : { held: false };

  return {
    criteria,
    box,
    contents,
    inboundProvenance: inboundRes.rows[0] || null,
    allocations,
    qualityHold: qualityHoldCheck.held ? qualityHoldCheck.hold : null,
  };
}

export async function forwardTrace(
  db: DB,
  actor: Actor,
  criteria: { productId?: string; lotId?: string; serialNumber?: string },
) {
  requireRule(
    Boolean(criteria.productId || criteria.lotId || criteria.serialNumber),
    "CRITERIA_REQUIRED",
    "Product ID, lot ID, or serial number is required for forward trace",
    422,
  );

  let productId = criteria.productId;
  if (!productId && criteria.lotId) {
    const lotRes = await db.query("SELECT product_id FROM lots WHERE id = $1 AND org_id = $2", [
      criteria.lotId,
      actor.org_id,
    ]);
    if (lotRes.rows.length) productId = lotRes.rows[0].product_id;
  }

  // 1. Current On-Hand Storage Locations
  let onHandQuery = `
    SELECT b.id box_id, b.code box_code, b.condition, b.status,
           loc.code location_code, loc.name location_name,
           p.code pallet_code,
           c.quantity, c.unit, l.reference lot_reference, l.expires_on
    FROM boxes b
    JOIN contents c ON c.box_id = b.id
    LEFT JOIN locations loc ON loc.id = b.location_id
    LEFT JOIN pallets p ON p.id = b.pallet_id
    LEFT JOIN lots l ON l.id = c.lot_id
    WHERE b.org_id = $1 AND b.status IN ('stored', 'unconfirmed')
  `;
  const onHandParams: any[] = [actor.org_id];
  if (productId) {
    onHandParams.push(productId);
    onHandQuery += ` AND c.product_id = $${onHandParams.length}`;
  }
  if (criteria.lotId) {
    onHandParams.push(criteria.lotId);
    onHandQuery += ` AND c.lot_id = $${onHandParams.length}`;
  }
  const onHand = (await db.query(onHandQuery, onHandParams)).rows;

  // 2. Outbound Shipments / Customer Deliveries
  let outboundQuery = `
    SELECT
      c.code customer_code, c.name customer_name,
      d.name destination_name, d.address destination_address,
      o.code order_code,
      s.id shipment_id, s.status shipment_status,
      sl.quantity shipped_quantity, sl.delivered delivered_quantity, sl.unit,
      t.code trip_code, t.business_date delivery_date,
      u.name driver_name
    FROM shipment_lines sl
    JOIN shipments s ON s.id = sl.shipment_id
    JOIN orders o ON o.id = s.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN destinations d ON d.id = s.destination_id
    LEFT JOIN trips t ON t.id = s.trip_id
    LEFT JOIN users u ON u.id = t.driver_id
    WHERE sl.org_id = $1
  `;
  const outboundParams: any[] = [actor.org_id];
  if (productId) {
    outboundParams.push(productId);
    outboundQuery += ` AND sl.product_id = $${outboundParams.length}`;
  }
  if (criteria.lotId) {
    outboundParams.push(criteria.lotId);
    outboundQuery += ` AND sl.box_id IN (SELECT box_id FROM contents WHERE lot_id = $${outboundParams.length})`;
  }
  const outbound = (await db.query(outboundQuery, outboundParams)).rows;

  // 3. Serial item record if applicable
  let serialRecord = null;
  if (criteria.serialNumber) {
    const sRes = await db.query(
      "SELECT * FROM item_serials WHERE org_id = $1 AND serial_number = $2",
      [actor.org_id, criteria.serialNumber],
    );
    serialRecord = sRes.rows[0] || null;
  }

  // 4. Quality Hold Status
  const holdCheck = await isQualityHeld(db, actor.org_id, actor.warehouse_id || `${actor.org_id}:legacy`, {
    productId,
    lotId: criteria.lotId,
    serialNumber: criteria.serialNumber,
  });

  return {
    criteria,
    onHandInventory: onHand,
    outboundDistribution: outbound,
    serial: serialRecord,
    qualityHold: holdCheck.held ? holdCheck.hold : null,
  };
}

// =========================================================================
// Serial Item Registration
// =========================================================================

export async function registerItemSerial(
  db: DB,
  actor: Actor,
  input: SerialRegister,
) {
  requireRule(
    actor.role === "admin" || actor.role === "administrator" || actor.role === "supervisor" || actor.role === "operator",
    "UNAUTHORIZED",
    "Operator, supervisor, or admin access required to register serial numbers",
    403,
  );
  const warehouseId = actor.warehouse_id || `${actor.org_id}:legacy`;

  return command(db, actor, "serials.register", input, async (t) => {
    // 1. Verify product
      const pRes = await t.query("SELECT id FROM products WHERE id = $1 AND org_id = $2", [
        input.productId,
        actor.org_id,
      ]);
      requireRule(pRes.rows.length > 0, "NOT_FOUND", "Product not found", 404);

      // 2. Uniqueness
      const existing = await t.query(
        "SELECT id FROM item_serials WHERE org_id = $1 AND product_id = $2 AND serial_number = $3",
        [actor.org_id, input.productId, input.serialNumber],
      );
      requireRule(existing.rows.length === 0, "SERIAL_EXISTS", "Serial number already registered for this product", 409);

      const id = uuid();
      const insertQuery = `
        INSERT INTO item_serials(id, org_id, warehouse_id, product_id, lot_id, serial_number, box_id, location_id, status)
        VALUES($1, $2, $3, $4, $5, $6, $7, $8, 'received')
        RETURNING *
      `;
      const serial = (
        await t.query(insertQuery, [
          id,
          actor.org_id,
          warehouseId,
          input.productId,
          input.lotId || null,
          input.serialNumber,
          input.boxId || null,
          input.locationId || null,
        ])
      ).rows[0];

      await event(t, actor, id, "serial.registered", {
        serialId: id,
        productId: input.productId,
        serialNumber: input.serialNumber,
      });

      return serial;
    });
}
