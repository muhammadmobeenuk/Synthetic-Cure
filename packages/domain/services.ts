import { validateActor, warehouseTables, legacyWarehouse } from "./context.js";
import { createHash, randomUUID as uuid } from "node:crypto";
import Decimal from "decimal.js";
import type { DB } from "../database/index.js";
import { canonical, requireRule, stages } from "./index.js";
export type Actor = {
  id: string;
  org_id: string;
  role: string;
  name: string;
  email: string;
  warehouse_id?: string | null;
  home_org_id?:string;
};
export const permissions: Record<string, string[]> = {
  administrator: ["*"],
  supervisor: [
    "receive",
    "move",
    "pack",
    "order",
    "prepare",
    "dispatch",
    "adjust",
    "review",
    "export",
  ],
  operator: ["receive", "move", "pack", "prepare", "review"],
  dispatcher: ["dispatch", "review", "export"],
  driver: ["handover"],
  reviewer: [],
};
export function authorize(actor: Actor, action: string) {
  requireRule(
    permissions[actor.role]?.some((p) => p === "*" || p === action),
    "FORBIDDEN",
    "Your role cannot perform this action",
    403,
  );
}
export async function owned(
  t: DB,
  table: string,
  id: string,
  a: Actor,
  lock = false,
) {
  const params:any[]=[id,a.org_id];
  const scope = a.warehouse_id !== undefined && warehouseTables.has(table);
  if(scope)params.push(a.warehouse_id||"__none__");
  const row = table === "users" ? (await t.query(
    `SELECT u.id,u.name,u.email,m.org_id,m.role,(u.active AND m.active) active FROM users u JOIN company_memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.org_id=$2${a.warehouse_id ? " AND EXISTS(SELECT 1 FROM warehouse_grants g WHERE g.user_id=u.id AND g.org_id=m.org_id AND g.warehouse_id=$3 AND g.active)" : ""}${lock ? " FOR UPDATE OF m" : ""}`,
    a.warehouse_id ? [id,a.org_id,a.warehouse_id] : [id,a.org_id]
  )).rows[0] : (await t.query(
    `SELECT * FROM ${table} WHERE id=$1 AND org_id=$2${scope ? " AND warehouse_id=$3" : ""}${lock ? " FOR UPDATE" : ""}`,params
  )).rows[0];
  requireRule(row, "NOT_FOUND", "Record not found", 404);
  return row;
}
export function version(row: any, expected: number) {
  requireRule(
    row.version === expected,
    "VERSION_CONFLICT",
    "This record changed. Your pending work is preserved; review the latest version.",
    409,
    { current: row },
  );
}
export async function event(
  t: DB,
  a: Actor,
  entity: string,
  kind: string,
  data: any,
) {
  await t.query(
    "INSERT INTO inventory_events(id,org_id,actor_id,entity_id,kind,data,warehouse_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [uuid(), a.org_id, a.id, entity, kind, JSON.stringify(data),a.warehouse_id || legacyWarehouse(a.org_id)],
  );
}
export async function command<T>(
  db: DB,
  a: Actor,
  name: string,
  payload: any,
  fn: (t: DB) => Promise<T>,
): Promise<T> {
  return db.transaction(async (t) => {
    if(name.startsWith("access-")||name.startsWith("warehouse-"))await t.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE",[a.org_id]);
    await validateActor(t,a);
    const key = a.org_id + ":" + name + ":" + payload.clientOperationId;
    if (t.native)
      await t.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        key,
      ]);
    const hash = createHash("sha256").update(canonical(payload)).digest("hex");
    const old = (
      await t.query(
        "SELECT * FROM operations WHERE org_id=$1 AND command=$2 AND operation_id=$3",
        [a.org_id, name, payload.clientOperationId],
      )
    ).rows[0];
    if (old) {
      requireRule(old.warehouse_id === (a.warehouse_id || legacyWarehouse(a.org_id)),"OPERATION_SCOPE","Operation belongs to a different warehouse context",409);
      requireRule(
        old.payload_hash === hash,
        "IDEMPOTENCY_MISMATCH",
        "Operation ID was already used with different data",
        409,
      );
      return old.result;
    }
    const result = await fn(t);
    await t.query(
      "INSERT INTO operations(org_id,command,operation_id,payload_hash,result,warehouse_id) VALUES($1,$2,$3,$4,$5,$6)",
      [a.org_id, name, payload.clientOperationId, hash, JSON.stringify(result),a.warehouse_id || legacyWarehouse(a.org_id)],
    );
    return result;
  });
}
export async function invalidate(t: DB, a: Actor, boxId: string) {
  const box = await owned(t, "boxes", boxId, a);
  if (box.pallet_id)
    await t.query(
      "UPDATE pallets SET manifest_revision=manifest_revision+1,checked_revision=NULL,version=version+1 WHERE id=$1",
      [box.pallet_id],
    );
  const orders = (
    await t.query("SELECT DISTINCT order_id FROM allocations WHERE box_id=$1", [
      boxId,
    ])
  ).rows;
  for (const o of orders) {
    await t.query(
      "UPDATE shipment_lines SET loaded=false WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id=$1 AND status IN ('ready','needs_recheck'))",
      [o.order_id],
    );
    await t.query(
      "UPDATE preparation_orders SET checked=false,stage=CASE WHEN stage='ready' THEN 'checking' ELSE stage END WHERE order_id=$1",
      [o.order_id],
    );
    await t.query(
      "UPDATE shipments SET status='needs_recheck',version=version+1 WHERE order_id=$1 AND status IN ('ready','needs_recheck')",
      [o.order_id],
    );
  }
}
export async function boxState(t: DB, a: Actor, id: string) {
  const b = await owned(t, "boxes", id, a);
  const detail = (
    await t.query(
      `SELECT b.*,COALESCE(b.location_id,p.location_id) AS effective_location_id,l.code AS location_code,p.code AS pallet_code,c.name AS customer_name FROM boxes b LEFT JOIN pallets p ON p.id=b.pallet_id LEFT JOIN locations l ON l.id=COALESCE(b.location_id,p.location_id) LEFT JOIN customers c ON c.id=b.customer_id WHERE b.id=$1 AND b.org_id=$2`,
      [id, a.org_id],
    )
  ).rows[0];
  detail.contents = (
    await t.query(
      "SELECT c.*,p.name,p.name_zh,p.sku FROM contents c JOIN products p ON p.id=c.product_id WHERE c.box_id=$1 ORDER BY c.id",
      [id],
    )
  ).rows;
  detail.documents = (
    await t.query(
      "SELECT id,name,mime,size FROM documents WHERE box_id=$1 AND org_id=$2",
      [id, a.org_id],
    )
  ).rows;
  detail.events = (
    await t.query(
      "SELECT e.*,u.name AS actor_name FROM inventory_events e JOIN users u ON u.id=e.actor_id WHERE e.org_id=$1 AND e.entity_id=$2 ORDER BY e.created_at,e.id",
      [a.org_id, id],
    )
  ).rows;
  detail.traceabilityProblems = await traceabilityProblems(t, a, id);
  return { ...b, ...detail };
}
export async function traceabilityProblems(t: DB, a: Actor, boxId: string) {
  const lines = (
    await t.query(
      "SELECT c.*,p.name,p.traceability_confirmed,p.require_lot,p.require_expiry,p.require_temperature,p.temperature_min,p.temperature_max,l.expires_on FROM contents c JOIN products p ON p.id=c.product_id LEFT JOIN lots l ON l.id=c.lot_id WHERE c.box_id=$1 AND c.org_id=$2",
      [boxId, a.org_id],
    )
  ).rows;
  const problems: string[] = [];
  for (const c of lines) {
    if (!c.traceability_confirmed) continue;
    if ((c.require_lot || c.require_expiry) && !c.lot_id)
      problems.push(c.name + ": verified batch required");
    if (c.require_expiry && !c.expires_on)
      problems.push(c.name + ": verified expiry date required");
    if (c.require_temperature && c.temperature_c === null)
      problems.push(c.name + ": measured temperature required");
    if (
      c.temperature_c !== null &&
      ((c.temperature_min !== null &&
        new Decimal(c.temperature_c).lt(c.temperature_min)) ||
        (c.temperature_max !== null &&
          new Decimal(c.temperature_c).gt(c.temperature_max)))
    )
      problems.push(c.name + ": measured temperature outside configured range");
  }
  return problems;
}
export async function assertBoxEligible(t: DB, a: Actor, boxId: string) {
  const b = await owned(t, "boxes", boxId, a, true);
  requireRule(
    b.status === "confirmed" && b.condition === "good",
    "UNAVAILABLE",
    "Only confirmed good-condition goods may be allocated or dispatched",
  );
  requireRule(
    !(
      await t.query(
        "SELECT id FROM issues WHERE box_id=$1 AND org_id=$2 AND status='open'",
        [boxId, a.org_id],
      )
    ).rows.length,
    "OPEN_ISSUE",
    "Resolve the open box issues and recheck the load",
  );
  const problems = await traceabilityProblems(t, a, boxId);
  requireRule(!problems.length, "TRACEABILITY_REQUIRED", problems.join("; "));
  return b;
}
async function putContents(t: DB, a: Actor, boxId: string, lines: any[]) {
  for (const l of lines) {
    const p = await owned(t, "products", l.productId, a);
    requireRule(
      l.unit === p.unit,
      "UNIT_MISMATCH",
      "Use the product base unit; no unverified pack conversion is available.",
    );
    if (l.lotId) {
      const lot = await owned(t, "lots", l.lotId, a);
      requireRule(
        lot.product_id === p.id,
        "BATCH_MISMATCH",
        "Batch belongs to another product",
      );
    }
    await t.query(
      "INSERT INTO contents(id,org_id,box_id,product_id,lot_id,quantity,unit,verified,temperature_c,catch_weight,package_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        uuid(),
        a.org_id,
        boxId,
        l.productId,
        l.lotId || null,
        l.quantity,
        l.unit,
        l.verified,
        l.temperatureC ?? null,
        l.catchWeight ?? null,
        l.packageCount ?? null,
      ],
    );
  }
}
export const services = {
  async receipt(t: DB, a: Actor, p: any) {
    await owned(t, "locations", p.locationId, a);
    if (p.customerId) await owned(t, "customers", p.customerId, a);
    const id = uuid(),
      code = "BOX-" + id.slice(0, 8).toUpperCase();
    await t.query(
      "INSERT INTO boxes(id,org_id,code,customer_id,location_id,source_label,condition,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        a.org_id,
        code,
        p.customerId,
        p.locationId,
        p.sourceLabel,
        p.condition,
        p.condition !== "good"
          ? "hold"
          : p.contents.length > 0 && p.contents.every((c: any) => c.verified)
            ? "confirmed"
            : "unconfirmed",
      ],
    );
    await putContents(t, a, id, p.contents);
    if (p.condition === 'good' && (await traceabilityProblems(t, a, id)).length)
      await t.query("UPDATE boxes SET status='unconfirmed' WHERE id=$1", [id]);
    await event(t, a, id, "box.received", {
      code,
      locationId: p.locationId,
      sourceLabel: p.sourceLabel,
    });
    return boxState(t, a, id);
  },
  async confirm(t: DB, a: Actor, id: string, p: any) {
    const b = await owned(t, "boxes", id, a, true);
    version(b, p.expectedVersion);
    requireRule(
      !["dispatched", "delivered", "returned"].includes(b.status),
      "CUSTODY_STATE",
      "Cannot edit goods after custody handover",
    );
    requireRule(
      !(await t.query("SELECT id FROM allocations WHERE box_id=$1", [id])).rows
        .length,
      "ALLOCATED",
      "Unallocate or repack before changing allocated contents",
    );
    const beforeContents = (
      await t.query("SELECT * FROM contents WHERE box_id=$1 ORDER BY id", [id])
    ).rows;
    const key = (c: any) =>
      canonical({
        productId: c.product_id || c.productId,
        quantity:
          c.quantity === null ? null : new Decimal(c.quantity).toFixed(),
        unit: c.unit,
      });
    const verifiedBefore = beforeContents
      .filter((c) => c.verified)
      .map(key)
      .sort();
    const verifiedAfter = p.contents
      .filter((c: any) => c.verified)
      .map(key)
      .sort();
    if (
      verifiedBefore.length &&
      canonical(verifiedBefore) !== canonical(verifiedAfter)
    ) {
      authorize(a, "adjust");
      requireRule(
        p.reason?.trim().length >= 3,
        "CORRECTION_REASON",
        "Changing a verified stock quantity requires a correction reason",
      );
    }
    await t.query("DELETE FROM contents WHERE box_id=$1", [id]);
    await putContents(t, a, id, p.contents);
    await t.query("UPDATE boxes SET status=$1,version=version+1 WHERE id=$2", [
      b.condition !== 'good' ? 'hold' : p.contents.every((c: any) => c.verified)
        ? "confirmed"
        : "unconfirmed",
      id,
    ]);
    if (b.condition === 'good' && (await traceabilityProblems(t, a, id)).length)
      await t.query("UPDATE boxes SET status='unconfirmed' WHERE id=$1", [id]);
    await invalidate(t, a, id);
    await event(t, a, id, "box.contents_confirmed", {
      beforeVersion: b.version,
      previousContents: beforeContents,
      reason: p.reason || null,
      contents: p.contents,
    });
    return boxState(t, a, id);
  },
  async move(t: DB, a: Actor, kind: "boxes" | "pallets", id: string, p: any) {
    const b = await owned(t, kind, id, a, true);
    version(b, p.expectedVersion);
    await owned(t, "locations", p.locationId, a);
    if (kind === "boxes") {
      requireRule(
        !b.pallet_id,
        "INHERITED_LOCATION",
        "Move the pallet or remove this box first",
      );
      requireRule(
        !["dispatched", "delivered", "returned"].includes(b.status),
        "CUSTODY_STATE",
        "This box is outside warehouse custody",
      );
    }
    if (kind === "pallets")
      requireRule(
        !(
          await t.query(
            "SELECT id FROM boxes WHERE pallet_id=$1 AND status IN ('dispatched','delivered','returned')",
            [id],
          )
        ).rows.length,
        "CUSTODY_STATE",
        "A pallet containing goods outside warehouse custody cannot be moved",
      );
    await t.query(
      `UPDATE ${kind} SET location_id=$1,version=version+1 WHERE id=$2`,
      [p.locationId, id],
    );
    await event(t, a, id, kind === "boxes" ? "box.moved" : "pallet.moved", {
      from: b.location_id,
      to: p.locationId,
      reason: p.reason,
    });
    return owned(t, kind, id, a);
  },
  async pallet(t: DB, a: Actor, p: any) {
    await owned(t, "locations", p.locationId, a);
    const id = uuid();
    await t.query(
      "INSERT INTO pallets(id,org_id,code,location_id) VALUES($1,$2,$3,$4)",
      [id, a.org_id, "PLT-" + id.slice(0, 8).toUpperCase(), p.locationId],
    );
    await event(t, a, id, "pallet.created", p);
    return owned(t, "pallets", id, a);
  },
  async membership(t: DB, a: Actor, id: string, p: any, remove = false) {
    const pallet = await owned(t, "pallets", id, a, true);
    version(pallet, p.expectedVersion);
    if (remove) {
      requireRule(
        p.locationId,
        "LOCATION_REQUIRED",
        "Choose a standalone destination",
      );
      await owned(t, "locations", p.locationId, a);
    }
    for (const bid of [...new Set<string>(p.boxIds)].sort()) {
      const b = await owned(t, "boxes", bid, a, true);
      requireRule(
        !["dispatched", "delivered", "returned"].includes(b.status),
        "CUSTODY_STATE",
        "Box is outside warehouse custody",
      );
      requireRule(
        remove ? b.pallet_id === id : !b.pallet_id,
        "MEMBERSHIP_CONFLICT",
        remove
          ? "Box is not on this pallet"
          : "Box already belongs to a pallet",
        409,
        { box: b },
      );
      await invalidate(t, a, bid);
      await t.query(
        "UPDATE boxes SET pallet_id=$1,location_id=$2,version=version+1 WHERE id=$3",
        [remove ? null : id, remove ? p.locationId : null, bid],
      );
      await event(
        t,
        a,
        bid,
        remove ? "pallet.box_removed" : "pallet.box_added",
        {
          palletId: id,
          locationId: remove ? p.locationId : pallet.location_id,
        },
      );
    }
    await t.query(
      "UPDATE pallets SET manifest_revision=manifest_revision+1,checked_revision=NULL,version=version+1 WHERE id=$1",
      [id],
    );
    await event(t, a, id, "pallet.membership_changed", {
      boxIds: p.boxIds,
      remove,
    });
    return owned(t, "pallets", id, a);
  },
  async verifyPallet(t: DB, a: Actor, id: string, p: any) {
    const pal = await owned(t, "pallets", id, a, true);
    version(pal, p.expectedVersion);
    const boxes = (
      await t.query("SELECT * FROM boxes WHERE pallet_id=$1", [id])
    ).rows;
    requireRule(
      boxes.length && boxes.every((b) => b.status === "confirmed"),
      "UNCONFIRMED",
      "Every box must be confirmed before checking the manifest",
    );
    await t.query(
      "UPDATE pallets SET checked_revision=manifest_revision,version=version+1 WHERE id=$1",
      [id],
    );
    await event(t, a, id, "pallet.checked", {
      revision: pal.manifest_revision,
    });
    return owned(t, "pallets", id, a);
  },
  async order(t: DB, a: Actor, p: any) {
    await owned(t, "customers", p.customerId, a);
    const destination = await owned(t, "destinations", p.destinationId, a);
    requireRule(
      destination.customer_id === p.customerId ||
        (
          await t.query(
            "SELECT id FROM destination_authorizations WHERE org_id=$1 AND customer_id=$2 AND destination_id=$3",
            [a.org_id, p.customerId, p.destinationId],
          )
        ).rows.length,
      "DESTINATION_AUTHORIZATION",
      "This customer-to-destination relationship is unconfirmed. A supervisor must authorize it first.",
    );
    const id = uuid();
    await t.query(
      "INSERT INTO orders(id,org_id,code,customer_id,destination_id,warehouse_id) VALUES($1,$2,$3,$4,$5,$6)",
      [
        id,
        a.org_id,
        "ORD-" + id.slice(0, 8).toUpperCase(),
        p.customerId,
        p.destinationId,
        a.warehouse_id || legacyWarehouse(a.org_id),
      ],
    );
    for (const l of p.lines) {
      const product = await owned(t, "products", l.productId, a);
      requireRule(
        product.unit === l.unit,
        "UNIT_MISMATCH",
        "Order unit must match the product base unit",
      );
      await t.query("INSERT INTO order_lines VALUES($1,$2,$3,$4,$5,$6)", [
        uuid(),
        a.org_id,
        id,
        l.productId,
        l.quantity,
        l.unit,
      ]);
    }
    await event(t, a, id, "order.created", p);
    return owned(t, "orders", id, a);
  },
  async allocate(t: DB, a: Actor, id: string, p: any) {
    const o = await owned(t, "orders", id, a, true);
    version(o, p.expectedVersion);
    requireRule(o.status === "open", "ORDER_STATE", "Order is not open");
    requireRule(
      !(
        await t.query(
          "SELECT id FROM shipments WHERE order_id=$1 AND status IN ('dispatched','partial','completed')",
          [id],
        )
      ).rows.length,
      "DELIVERY_STARTED",
      "Delivery custody has started. Use a new internal replacement order for additional goods.",
    );
    const b = await assertBoxEligible(t, a, p.boxId);
    requireRule(
      b.status === "confirmed" && b.condition === "good",
      "UNAVAILABLE",
      "Only confirmed, good-condition stock can be allocated",
    );
    requireRule(
      !(
        await t.query("SELECT id FROM issues WHERE box_id=$1 AND status=$2", [
          b.id,
          "open",
        ])
      ).rows.length,
      "OPEN_ISSUE",
      "Resolve the box review issue first",
    );
    const l = await owned(t, "order_lines", p.orderLineId, a, true);
    requireRule(
      l.order_id === id,
      "ORDER_LINE",
      "Line is not part of this order",
    );
    const cs = (
      await t.query(
        "SELECT * FROM contents WHERE box_id=$1 ORDER BY id FOR UPDATE",
        [b.id],
      )
    ).rows;
    requireRule(
      cs.length === 1 &&
        cs[0].verified &&
        cs[0].product_id === l.product_id &&
        cs[0].unit === l.unit,
      "CONTENTS_MISMATCH",
      "This candidate allocates a whole single-product box. Repack mixed boxes first.",
    );
    requireRule(
      new Decimal(cs[0].quantity).equals(p.quantity),
      "REPACK_REQUIRED",
      "Allocate the whole box quantity, or repack it first",
    );
    requireRule(
      !(await t.query("SELECT id FROM allocations WHERE box_id=$1", [b.id]))
        .rows.length,
      "STOCK_CONFLICT",
      "This box is already allocated",
      409,
    );
    // Invariant: Stock under active quality hold/quarantine cannot be allocated
    const warehouseId = a.warehouse_id || `${a.org_id}:legacy`;
    const activeHold = await t.query(
      `SELECT id, reason FROM quality_holds
       WHERE org_id = $1 AND warehouse_id = $2 AND status = 'active'
         AND (
           (scope = 'box' AND target_id = $3) OR
           (scope = 'product' AND target_id = $4) OR
           (scope = 'lot' AND target_id = $5) OR
           (scope = 'location' AND target_id = $6)
         )
       LIMIT 1`,
      [a.org_id, warehouseId, b.id, cs[0].product_id, cs[0].lot_id || 'none', b.location_id || 'none'],
    );
    requireRule(
      activeHold.rows.length === 0,
      "QUALITY_HOLD",
      "Stock cannot be allocated: active quality hold (" + (activeHold.rows[0]?.reason || "") + ")",
      422,
    );

    const sum = (
      await t.query(
        "SELECT COALESCE(sum(quantity),0)::text total FROM allocations WHERE order_line_id=$1",
        [l.id],
      )
    ).rows[0].total;
    requireRule(
      new Decimal(sum).plus(p.quantity).lte(l.quantity),
      "OVER_ALLOCATION",
      "Allocation exceeds order demand",
      409,
    );
    await t.query("INSERT INTO allocations VALUES($1,$2,$3,$4,$5,$6,$7)", [
      uuid(),
      a.org_id,
      id,
      l.id,
      b.id,
      cs[0].id,
      p.quantity,
    ]);
    await t.query("UPDATE orders SET version=version+1 WHERE id=$1", [id]);
    await invalidate(t, a, b.id);
    await event(t, a, id, "stock.allocated", {
      boxId: b.id,
      quantity: p.quantity,
      unit: l.unit,
    });
    return owned(t, "orders", id, a);
  },
  async cancel(t: DB, a: Actor, id: string, p: any) {
    const o = await owned(t, "orders", id, a, true);
    version(o, p.expectedVersion);
    requireRule(
      o.status === "open",
      "ORDER_STATE",
      "Cannot cancel a closed order",
    );
    requireRule(
      !(
        await t.query(
          "SELECT id FROM shipments WHERE order_id=$1 AND status NOT IN ('ready','needs_recheck','cancelled')",
          [id],
        )
      ).rows.length,
      "CUSTODY_STATE",
      "Resolve dispatched goods before cancellation",
    );
    await t.query("DELETE FROM allocations WHERE order_id=$1", [id]);
    await t.query(
      "UPDATE shipments SET status='cancelled',version=version+1 WHERE order_id=$1",
      [id],
    );
    await t.query("DELETE FROM preparation_orders WHERE order_id=$1", [id]);
    await t.query(
      "UPDATE orders SET status='cancelled',version=version+1 WHERE id=$1",
      [id],
    );
    await event(t, a, id, "order.cancelled", { reason: p.reason });
    return owned(t, "orders", id, a);
  },
  async preparation(t: DB, a: Actor, p: any) {
    const id = uuid();
    await t.query(
      "INSERT INTO preparations(id,org_id,business_date,warehouse_id,configuration_version,policy_snapshot) SELECT $1,$2,$3,$4,version,jsonb_build_object('timezone',timezone,'preparationWeekdays',preparation_weekdays,'scheduleReviewed',schedule_reviewed) FROM company_configuration WHERE org_id=$2",
      [id, a.org_id, p.businessDate,a.warehouse_id || legacyWarehouse(a.org_id)],
    );
    for (const oid of [...new Set<string>(p.orderIds)].sort()) {
      const o = await owned(t, "orders", oid, a, true);
      requireRule(
        o.status === "open",
        "ORDER_STATE",
        "Only open orders can be prepared",
      );
      requireRule(
        !(
          await t.query(
            "SELECT order_id FROM preparation_orders WHERE order_id=$1",
            [oid],
          )
        ).rows.length,
        "ALREADY_PLANNED",
        "Order is already in a preparation batch",
        409,
      );
      await t.query(
        "INSERT INTO preparation_orders(preparation_id,order_id) VALUES($1,$2)",
        [id, oid],
      );
    }
    await event(t, a, id, "preparation.created", {
      businessDate: p.businessDate,
      orderIds: p.orderIds,
      deliveryDate: null,
    });
    return owned(t, "preparations", id, a);
  },
  async advance(t: DB, a: Actor, batchId: string, id: string, p: any) {
    await owned(t, "preparations", batchId, a, true);
    const o = await owned(t, "orders", id, a, true);
    version(o, p.expectedVersion);
    const po = (
      await t.query(
        "SELECT * FROM preparation_orders WHERE preparation_id=$1 AND order_id=$2 FOR UPDATE",
        [batchId, id],
      )
    ).rows[0];
    requireRule(po, "NOT_FOUND", "Order is not in this preparation batch", 404);
    requireRule(
      stages.indexOf(p.stage) === stages.indexOf(po.stage) + 1,
      "STAGE_SEQUENCE",
      "Complete the next stage in sequence",
    );
    const as = (
      await t.query(
        "SELECT a.*,b.pallet_id,b.status,b.condition FROM allocations a JOIN boxes b ON b.id=a.box_id WHERE a.order_id=$1 ORDER BY a.box_id FOR UPDATE OF b",
        [id],
      )
    ).rows;
    if (p.stage !== "picking") {
      requireRule(as.length, "SHORTAGE", "Allocate and pick boxes first");
      const lines = (
        await t.query(
          "SELECT l.*,COALESCE((SELECT sum(a.quantity) FROM allocations a WHERE a.order_line_id=l.id),0)::text allocated FROM order_lines l WHERE order_id=$1",
          [id],
        )
      ).rows;
      const short = lines.some((l) => new Decimal(l.allocated).lt(l.quantity));
      if (short) {
        requireRule(
          p.partialApproved,
          "SHORTAGE",
          "Shortage remains. A supervisor must explicitly approve partial fulfilment.",
        );
        authorize(a, "adjust");
        requireRule(
          p.reason?.length >= 3,
          "REASON_REQUIRED",
          "Record the partial fulfilment reason",
        );
      }
      requireRule(
        as.every((x) => x.status === "confirmed" && x.condition === "good"),
        "UNCONFIRMED",
        "Allocated goods are not confirmed",
      );
    }
    if (p.stage === "packing")
      await t.query(
        "UPDATE allocations SET picked_quantity=quantity WHERE order_id=$1",
        [id],
      );
    if (p.stage === "ready") {
      requireRule(
        p.stagingLocationId,
        "STAGING_REQUIRED",
        "Confirm a staging location",
      );
      const loc = await owned(t, "locations", p.stagingLocationId, a);
      requireRule(
        loc.kind === "staging",
        "STAGING_REQUIRED",
        "Choose a configured staging location",
      );
      for (const al of as) {
        const b = await assertBoxEligible(t, a, al.box_id);
        if (b.pallet_id) {
          const pal = await owned(t, "pallets", b.pallet_id, a, true);
          requireRule(
            pal.checked_revision === pal.manifest_revision,
            "MANIFEST_UNCHECKED",
            "Check the current pallet manifest first",
          );
          requireRule(
            pal.location_id === loc.id,
            "NOT_STAGED",
            "Physically move the pallet to the staging location first",
          );
        } else
          requireRule(
            b.location_id === loc.id,
            "NOT_STAGED",
            "Physically move allocated boxes to staging first",
          );
        requireRule(
          !(
            await t.query(
              "SELECT id FROM issues WHERE box_id=$1 AND status=$2",
              [b.id, "open"],
            )
          ).rows.length,
          "OPEN_ISSUE",
          "Resolve outstanding box issues",
        );
      }
      let ship = (
        await t.query(
          "SELECT * FROM shipments WHERE order_id=$1 AND status IN ('ready','needs_recheck')",
          [id],
        )
      ).rows[0];
      if (!ship) {
        const sid = uuid();
        await t.query(
          "INSERT INTO shipments(id,org_id,order_id,destination_id) VALUES($1,$2,$3,$4)",
          [sid, a.org_id, id, o.destination_id],
        );
        ship = { id: sid };
      } else {
        await t.query("DELETE FROM shipment_lines WHERE shipment_id=$1", [
          ship.id,
        ]);
        await t.query(
          "UPDATE shipments SET status='ready',version=version+1 WHERE id=$1",
          [ship.id],
        );
      }
      for (const al of as) {
        const ct = await owned(t, "contents", al.contents_id, a);
        await t.query(
          "INSERT INTO shipment_lines(id,org_id,shipment_id,box_id,product_id,quantity,unit) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            uuid(),
            a.org_id,
            ship.id,
            al.box_id,
            ct.product_id,
            al.quantity,
            ct.unit,
          ],
        );
      }
    }
    await t.query(
      "UPDATE preparation_orders SET stage=$1,checked=$2,staging_location_id=COALESCE($3,staging_location_id) WHERE preparation_id=$4 AND order_id=$5",
      [p.stage, p.stage === "ready", p.stagingLocationId || null, batchId, id],
    );
    await t.query(
      "UPDATE orders SET version=version+1,partial_approved=$1 WHERE id=$2",
      [!!p.partialApproved || o.partial_approved, id],
    );
    await event(t, a, id, "preparation." + p.stage, {
      batchId,
      stagingLocationId: p.stagingLocationId,
      partialApproved: p.partialApproved,
      reason: p.reason,
    });
    return owned(t, "orders", id, a);
  },
  async trip(t: DB, a: Actor, p: any) {
    if (p.driverId) {
      const driver = await owned(t, "users", p.driverId, a);
      requireRule(
        driver.role === "driver" && driver.active,
        "DRIVER_ROLE",
        "Assigned user must have the driver role",
      );
    }
    const id = uuid();
    await t.query(
      "INSERT INTO trips(id,org_id,code,business_date,driver_id,vehicle,warehouse_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        a.org_id,
        "TRIP-" + id.slice(0, 6).toUpperCase(),
        p.businessDate,
        p.driverId,
        p.vehicle,
        a.warehouse_id || legacyWarehouse(a.org_id),
      ],
    );
    let position = 0;
    const stopByDest = new Map<string, string>();
    for (const sid of [...new Set<string>(p.shipmentIds)]) {
      const s = await owned(t, "shipments", sid, a, true);
      requireRule(
        s.status === "ready" && !s.trip_id,
        "SHIPMENT_STATE",
        "Shipment must be ready and unassigned",
      );
      let stop = stopByDest.get(s.destination_id);
      if (!stop) {
        stop = uuid();
        stopByDest.set(s.destination_id, stop);
        await t.query("INSERT INTO stops VALUES($1,$2,$3,$4,$5)", [
          stop,
          a.org_id,
          id,
          s.destination_id,
          ++position,
        ]);
      }
      await t.query(
        "UPDATE shipments SET trip_id=$1,stop_id=$2,version=version+1 WHERE id=$3",
        [id, stop, sid],
      );
    }
    await event(t, a, id, "trip.created", {
      driverId: p.driverId,
      vehicle: p.vehicle,
      deliveryDate: p.businessDate,
      shipmentIds: p.shipmentIds,
    });
    return owned(t, "trips", id, a);
  },
  async load(t: DB, a: Actor, id: string, p: any) {
    const s = await owned(t, "shipments", id, a, true);
    version(s, p.expectedVersion);
    requireRule(
      s.status === "ready",
      "SHIPMENT_STATE",
      "Shipment must be ready",
    );
    const b = await assertBoxEligible(t, a, p.boxId);
    requireRule(
      (
        await t.query(
          "SELECT id FROM shipment_lines WHERE shipment_id=$1 AND box_id=$2",
          [id, b.id],
        )
      ).rows.length,
      "WRONG_SHIPMENT",
      "Box is not on this approved shipment manifest",
    );
    requireRule(b.status === "confirmed", "BOX_STATE", "Box must be confirmed");
    const po = (
      await t.query("SELECT * FROM preparation_orders WHERE order_id=$1", [
        s.order_id,
      ])
    ).rows[0];
    requireRule(
      po?.checked && po.stage === "ready",
      "NEEDS_RECHECK",
      "Preparation must be checked and ready",
    );
    if (b.pallet_id) {
      const pal = await owned(t, "pallets", b.pallet_id, a, true);
      requireRule(
        pal.checked_revision === pal.manifest_revision,
        "MANIFEST_UNCHECKED",
        "Pallet contents changed. Recheck the pallet.",
      );
    }
    const previous = (
      await t.query(
        "SELECT loaded FROM shipment_lines WHERE shipment_id=$1 AND box_id=$2",
        [id, b.id],
      )
    ).rows;
    if (previous.length && previous.every((l) => l.loaded))
      return {
        ...s,
        duplicate: true,
        message: "Already loaded · no quantity or event added",
      };
    await t.query(
      "UPDATE shipment_lines SET loaded=true WHERE shipment_id=$1 AND box_id=$2",
      [id, b.id],
    );
    await t.query("UPDATE shipments SET version=version+1 WHERE id=$1", [id]);
    await event(t, a, id, "shipment.box_loaded", { boxId: b.id });
    return owned(t, "shipments", id, a);
  },
  async dispatch(t: DB, a: Actor, id: string, p: any) {
    const s = await owned(t, "shipments", id, a, true);
    version(s, p.expectedVersion);
    requireRule(
      s.status === "ready" && s.trip_id,
      "SHIPMENT_STATE",
      "Assign the ready shipment to a trip first",
    );
    const tr = await owned(t, "trips", s.trip_id, a, true);
    requireRule(
      tr.driver_id && tr.vehicle,
      "ASSIGNMENT_REQUIRED",
      "Assign driver and vehicle before dispatch",
    );
    const assignedDriver = await owned(t, "users", tr.driver_id, a);
    requireRule(
      assignedDriver.role === "driver" && assignedDriver.active,
      "DRIVER_INACTIVE",
      "Assign an active driver",
    );
    const destination = await owned(t, "destinations", s.destination_id, a);
    const addressVerified =
      destination.verified && !!destination.address?.trim();
    if (!addressVerified) {
      requireRule(
        p.addressOverride,
        "ADDRESS_UNVERIFIED",
        "Dispatch blocked: verify the delivery address or request a recorded supervisor exception",
      );
      authorize(a, "adjust");
      requireRule(
        p.addressOverrideReason?.trim().length >= 3,
        "REASON_REQUIRED",
        "Record the supervisor address exception reason",
      );
    }
    const prep = (
      await t.query("SELECT * FROM preparation_orders WHERE order_id=$1", [
        s.order_id,
      ])
    ).rows[0];
    requireRule(
      prep?.checked && prep.stage === "ready",
      "NEEDS_RECHECK",
      "Recheck preparation before dispatch",
    );
    let ls = (
      await t.query(
        "SELECT * FROM shipment_lines WHERE shipment_id=$1 ORDER BY id FOR UPDATE",
        [id],
      )
    ).rows;
    requireRule(
      ls.length && ls.some((l) => l.loaded),
      "MISSING_LOAD",
      "Load at least one manifest box first",
    );
    if (ls.some((l) => !l.loaded)) {
      requireRule(
        p.partialApproved,
        "MISSING_LOAD",
        "Missing boxes remain. A supervisor must explicitly approve splitting the outstanding shipment.",
      );
      authorize(a, "adjust");
      requireRule(
        p.reason?.length >= 3,
        "REASON_REQUIRED",
        "Record the partial dispatch reason",
      );
      const remainingId = uuid();
      await t.query(
        "INSERT INTO shipments(id,org_id,order_id,destination_id) VALUES($1,$2,$3,$4)",
        [remainingId, a.org_id, s.order_id, s.destination_id],
      );
      await t.query(
        "UPDATE shipment_lines SET shipment_id=$1 WHERE shipment_id=$2 AND loaded=false",
        [remainingId, id],
      );
      await t.query(
        "UPDATE orders SET partial_approved=true,version=version+1 WHERE id=$1",
        [s.order_id],
      );
      await event(t, a, id, "shipment.partial_split", {
        remainingShipmentId: remainingId,
        reason: p.reason,
      });
      ls = ls.filter((l) => l.loaded);
    }
    for (const l of ls) {
      const b = await assertBoxEligible(t, a, l.box_id);
      requireRule(
        b.status === "confirmed",
        "CUSTODY_STATE",
        "Goods are no longer available",
      );
      if (b.pallet_id) {
        const pal = await owned(t, "pallets", b.pallet_id, a, true);
        requireRule(
          pal.checked_revision === pal.manifest_revision,
          "MANIFEST_UNCHECKED",
          "Recheck the pallet",
        );
        const siblings = (
          await t.query(
            "SELECT b.id,sl.loaded,s.trip_id FROM boxes b LEFT JOIN shipment_lines sl ON sl.box_id=b.id AND sl.shipment_id IN (SELECT id FROM shipments WHERE status IN ('ready','needs_recheck','dispatched','partial')) LEFT JOIN shipments s ON s.id=sl.shipment_id WHERE b.pallet_id=$1",
            [pal.id],
          )
        ).rows;
        requireRule(
          siblings.every((x) => x.trip_id === s.trip_id && x.loaded),
          "MIXED_PALLET_LOAD",
          "Every box on this pallet must be loaded onto a shipment on the same trip before dispatch",
        );
      }
      await t.query(
        "UPDATE boxes SET status='dispatched',version=version+1 WHERE id=$1",
        [b.id],
      );
      await event(t, a, b.id, "box.custody_handover", {
        shipmentId: id,
        tripId: s.trip_id,
      });
    }
    await t.query(
      "UPDATE shipments SET status='dispatched',version=version+1 WHERE id=$1",
      [id],
    );
    await t.query(
      "UPDATE trips SET status='in_progress',version=version+1 WHERE id=$1",
      [s.trip_id],
    );
    await event(t, a, id, "shipment.dispatched", {
      tripId: s.trip_id,
      recipient: {
        name: destination.name,
        address: destination.address,
        verified: !!addressVerified,
      },
      addressException: !addressVerified
        ? { reason: p.addressOverrideReason, actorId: a.id }
        : null,
    });
    return owned(t, "shipments", id, a);
  },
  async handover(t: DB, a: Actor, id: string, p: any) {
    const s = await owned(t, "shipments", id, a, true);
    requireRule(
      ["dispatched", "partial"].includes(s.status),
      "SHIPMENT_STATE",
      "Shipment is not in delivery custody",
    );
    const trip = await owned(t, "trips", s.trip_id, a, true);
    if (a.role === "driver")
      requireRule(
        trip.driver_id === a.id,
        "FORBIDDEN",
        "This trip is not assigned to you",
        403,
      );
    version(s, p.expectedVersion);
    for (const l of p.lines) {
      const old = await owned(t, "shipment_lines", l.lineId, a, true);
      requireRule(
        old.shipment_id === id,
        "WRONG_SHIPMENT",
        "Line belongs to another shipment",
      );
      const delivered = new Decimal(old.delivered).plus(l.delivered),
        returned = new Decimal(old.returned).plus(l.returned);
      requireRule(
        delivered.plus(returned).lte(old.quantity),
        "OVER_HANDOVER",
        "Delivered plus returned exceeds outstanding shipment quantity",
      );
      await t.query(
        "UPDATE shipment_lines SET delivered=$1,returned=$2 WHERE id=$3",
        [delivered.toFixed(), returned.toFixed(), l.lineId],
      );
      if (new Decimal(l.returned).gt(0)) {
        await t.query(
          "UPDATE boxes SET status='returned',condition='hold',version=version+1 WHERE id=$1",
          [old.box_id],
        );
        await t.query(
          "INSERT INTO issues(id,org_id,box_id,kind,note) VALUES($1,$2,$3,$4,$5)",
          [uuid(), a.org_id, old.box_id, "return disposition", p.note],
        );
      }
      await event(t, a, old.box_id, "delivery.handover", {
        shipmentId: id,
        delivered: l.delivered,
        returned: l.returned,
        unit: old.unit,
        note: p.note,
      });
    }
    const lines = (
      await t.query("SELECT * FROM shipment_lines WHERE shipment_id=$1", [id])
    ).rows;
    const complete = lines.every((l) =>
      new Decimal(l.delivered).plus(l.returned).eq(l.quantity),
    );
    await t.query(
      "UPDATE shipments SET status=$1,version=version+1 WHERE id=$2",
      [complete ? "completed" : "partial", id],
    );
    for (const l of lines)
      if (new Decimal(l.delivered).eq(l.quantity))
        await t.query(
          "UPDATE boxes SET status='delivered',version=version+1 WHERE id=$1",
          [l.box_id],
        );
    await event(t, a, id, "shipment.handover", {
      lines: p.lines,
      note: p.note,
      complete,
    });
    return owned(t, "shipments", id, a);
  },
  async configureTraceability(t: DB, a: Actor, id: string, p: any) {
    authorize(a, "configure");
    const product = await owned(t, "products", id, a, true);
    version(product, p.expectedVersion);
    await t.query(
      "UPDATE products SET traceability_confirmed=true,require_lot=$1,require_expiry=$2,require_temperature=$3,temperature_min=$4,temperature_max=$5,traceability_reason=$6,version=version+1 WHERE id=$7",
      [
        p.requireLot,
        p.requireExpiry,
        p.requireTemperature,
        p.temperatureMin,
        p.temperatureMax,
        p.reason,
        id,
      ],
    );
    const affected = (
      await t.query(
        "SELECT DISTINCT b.id,b.warehouse_id FROM boxes b JOIN contents c ON c.box_id=b.id WHERE c.product_id=$1 AND b.org_id=$2 AND b.status NOT IN ('dispatched','delivered','returned') ORDER BY b.id",
        [id, a.org_id],
      )
    ).rows;
    for (const b of affected) {
      // Company-wide administrator policy update; preserve each affected box's real warehouse audit scope.
      const affectedActor={...a,warehouse_id:b.warehouse_id};
      const problems = await traceabilityProblems(t, affectedActor, b.id);
      if (problems.length)
        await t.query(
          "UPDATE boxes SET status='unconfirmed',version=version+1 WHERE id=$1",
          [b.id],
        );
      await invalidate(t, affectedActor, b.id);
      await event(t, affectedActor, b.id, "product.traceability_review_required", {
        productId: id,
        problems,
      });
    }
    await event(t, a, id, "product.traceability_configured", {
      before: {
        confirmed: product.traceability_confirmed,
        requireLot: product.require_lot,
        requireExpiry: product.require_expiry,
        requireTemperature: product.require_temperature,
        min: product.temperature_min,
        max: product.temperature_max,
      },
      after: p,
      affectedBoxIds: affected.map((b) => b.id),
    });
    return owned(t, "products", id, a);
  },
  async loosePick(t: DB, a: Actor, id: string, p: any) {
    const order = await owned(t, "orders", id, a, true);
    version(order, p.expectedVersion);
    requireRule(order.status === "open", "ORDER_STATE", "Order is not open");
    requireRule(
      !(
        await t.query(
          "SELECT id FROM shipments WHERE order_id=$1 AND status IN ('dispatched','partial','completed')",
          [id],
        )
      ).rows.length,
      "DELIVERY_STARTED",
      "Use a new replacement order after delivery starts",
    );
    const prep = (
      await t.query(
        "SELECT * FROM preparation_orders WHERE order_id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    requireRule(
      prep?.stage === "picking",
      "PICKING_STAGE",
      "Start Picking on the preparation board before recording a loose pick",
    );
    const line = await owned(t, "order_lines", p.orderLineId, a, true);
    requireRule(
      line.order_id === id,
      "ORDER_LINE",
      "Line belongs to another order",
    );
    const source = await owned(t, "boxes", p.sourceBoxId, a, true);
    version(source, p.sourceVersion);
    requireRule(
      source.condition === "good" &&
        ["confirmed", "unconfirmed"].includes(source.status),
      "SOURCE_UNAVAILABLE",
      "Source goods are held or outside warehouse custody",
    );
    requireRule(
      !(
        await t.query(
          "SELECT id FROM issues WHERE box_id=$1 AND status='open'",
          [source.id],
        )
      ).rows.length,
      "OPEN_ISSUE",
      "Resolve source-box issues before picking",
    );
    requireRule(
      !(
        await t.query("SELECT id FROM allocations WHERE box_id=$1", [source.id])
      ).rows.length,
      "SOURCE_ALLOCATED",
      "This source box is reserved. Release its allocation before loose picking",
    );
    const ct = await owned(t, "contents", p.contentsId, a, true);
    requireRule(
      ct.box_id === source.id && ct.verified && ct.quantity !== null,
      "UNCONFIRMED",
      "Choose a verified source contents line",
    );
    requireRule(
      ct.product_id === line.product_id && ct.unit === line.unit,
      "CONTENTS_MISMATCH",
      "Product and unit must match the order line",
    );
    const trace = await traceabilityProblems(t, a, source.id);
    requireRule(!trace.length, "TRACEABILITY_REQUIRED", trace.join("; "));
    const remaining = new Decimal(ct.quantity).minus(p.quantity);
    requireRule(
      remaining.gte(0),
      "INSUFFICIENT_STOCK",
      "Loose pick exceeds available verified source quantity",
      409,
    );
    const total = (
      await t.query(
        "SELECT COALESCE(sum(quantity),0)::text total FROM allocations WHERE order_line_id=$1",
        [line.id],
      )
    ).rows[0].total;
    requireRule(
      new Decimal(total).plus(p.quantity).lte(line.quantity),
      "OVER_ALLOCATION",
      "Picked quantity exceeds remaining order demand",
      409,
    );
    await owned(t, "locations", p.locationId, a);
    let target: any;
    if (p.targetBoxId) {
      requireRule(
        p.targetBoxId !== source.id,
        "PICK_TARGET",
        "Source and picking container must differ",
      );
      target = await owned(t, "boxes", p.targetBoxId, a, true);
      version(target, p.targetVersion);
      requireRule(
        !target.pallet_id &&
          target.condition === "good" &&
          ["confirmed", "empty"].includes(target.status),
        "PICK_TARGET",
        "Choose a standalone good-condition picking container",
      );
      requireRule(
        target.location_id === p.locationId,
        "LOCATION_MISMATCH",
        "Confirm the existing picking container at its recorded physical location",
      );
      requireRule(
        !target.customer_id || target.customer_id === order.customer_id,
        "CUSTOMER_MISMATCH",
        "Picking container belongs to another customer",
      );
      const contents = (
        await t.query(
          "SELECT * FROM contents WHERE box_id=$1 ORDER BY id FOR UPDATE",
          [target.id],
        )
      ).rows;
      requireRule(
        contents.length <= 1,
        "MIXED_TARGET",
        "Choose a single-product picking container",
      );
      const existing = contents[0];
      if (existing) {
        requireRule(
          existing.verified &&
            existing.product_id === ct.product_id &&
            existing.unit === ct.unit &&
            existing.lot_id === ct.lot_id,
          "BATCH_MISMATCH",
          "Repeated picks into a container must have the same product, unit and batch",
        );
        await t.query(
          "UPDATE contents SET quantity=quantity+$1,temperature_c=COALESCE($2,temperature_c) WHERE id=$3",
          [p.quantity, p.temperatureC ?? null, existing.id],
        );
      } else
        await putContents(t, a, target.id, [
          {
            productId: ct.product_id,
            quantity: p.quantity,
            unit: ct.unit,
            lotId: ct.lot_id || undefined,
            verified: true,
            temperatureC: p.temperatureC ?? null,
          },
        ]);
      await t.query(
        "UPDATE boxes SET customer_id=$1,status='confirmed',version=version+1 WHERE id=$2",
        [order.customer_id, target.id],
      );
    } else
      target = await services.receipt(t, a, {
        customerId: order.customer_id,
        locationId: p.locationId,
        sourceLabel: "Order picking container · " + order.code,
        condition: "good",
        contents: [
          {
            productId: ct.product_id,
            quantity: p.quantity,
            unit: ct.unit,
            lotId: ct.lot_id || undefined,
            verified: true,
            temperatureC: p.temperatureC ?? null,
          },
        ],
      });
    const allocated = (
      await t.query("SELECT * FROM allocations WHERE box_id=$1 FOR UPDATE", [
        target.id,
      ])
    ).rows[0];
    requireRule(
      !allocated || allocated.order_line_id === line.id,
      "TARGET_ALLOCATED",
      "Picking container is allocated to another order line",
    );
    const targetProblems = await traceabilityProblems(t, a, target.id);
    requireRule(
      !targetProblems.length,
      "TRACEABILITY_REQUIRED",
      targetProblems.join("; "),
    );
    requireRule(
      !(
        await t.query(
          "SELECT id FROM issues WHERE box_id=$1 AND status='open'",
          [target.id],
        )
      ).rows.length,
      "OPEN_ISSUE",
      "Resolve picking-container issues first",
    );
    const targetTotal = (
      await t.query("SELECT quantity FROM contents WHERE box_id=$1", [
        target.id,
      ])
    ).rows[0].quantity;
    requireRule(
      new Decimal(targetTotal).eq(
        new Decimal(allocated?.quantity || 0).plus(p.quantity),
      ) &&
        (!allocated ||
          new Decimal(allocated.picked_quantity).eq(allocated.quantity)),
      "TARGET_RESERVATION",
      "Reuse an already picked container for this order, or select an empty/new container",
    );
    if (remaining.isZero())
      await t.query("DELETE FROM contents WHERE id=$1", [ct.id]);
    else
      await t.query("UPDATE contents SET quantity=$1 WHERE id=$2", [
        remaining.toFixed(),
        ct.id,
      ]);
    const sourceContents = (
      await t.query("SELECT verified FROM contents WHERE box_id=$1", [
        source.id,
      ])
    ).rows;
    await t.query("UPDATE boxes SET status=$1,version=version+1 WHERE id=$2", [
      sourceContents.length
        ? sourceContents.every((c) => c.verified)
          ? "confirmed"
          : "unconfirmed"
        : "empty",
      source.id,
    ]);
    const targetCt = (
      await t.query("SELECT * FROM contents WHERE box_id=$1", [target.id])
    ).rows[0];
    if (allocated)
      await t.query(
        "UPDATE allocations SET quantity=quantity+$1,picked_quantity=picked_quantity+$1 WHERE id=$2",
        [p.quantity, allocated.id],
      );
    else
      await t.query(
        "INSERT INTO allocations(id,org_id,order_id,order_line_id,box_id,contents_id,quantity,picked_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$7)",
        [uuid(), a.org_id, id, line.id, target.id, targetCt.id, p.quantity],
      );
    await invalidate(t, a, source.id);
    await invalidate(t, a, target.id);
    await t.query("UPDATE orders SET version=version+1 WHERE id=$1", [id]);
    const details = {
      orderId: id,
      sourceBoxId: source.id,
      targetBoxId: target.id,
      productId: ct.product_id,
      lotId: ct.lot_id,
      quantity: p.quantity,
      unit: ct.unit,
      sourceRemaining: remaining.toFixed(),
      reason: p.reason,
    };
    await event(t, a, source.id, "stock.loose_picked", details);
    await event(t, a, target.id, "stock.pick_received", details);
    await event(t, a, id, "order.loose_picked", details);
    return {
      order: await owned(t, "orders", id, a),
      source: await boxState(t, a, source.id),
      target: await boxState(t, a, target.id),
    };
  },
  async repack(t: DB, a: Actor, id: string, p: any) {
    const b = await owned(t, "boxes", id, a, true);
    version(b, p.expectedVersion);
    requireRule(
      b.status === "confirmed",
      "BOX_STATE",
      "Use a confirmed box",
    );
    const ct = await owned(t, "contents", p.contentsId, a, true);
    requireRule(
      ct.box_id === id && ct.verified,
      "CONTENTS",
      "Choose verified contents from this box",
    );
    const remaining = new Decimal(ct.quantity).minus(p.quantity);
    requireRule(
      remaining.gt(0),
      "REPACK_QUANTITY",
      "Split quantity must be less than the source quantity",
    );
    const allocs = (await t.query("SELECT * FROM allocations WHERE box_id=$1", [id])).rows;
    for (const alloc of allocs) {
      if (new Decimal(alloc.quantity).gt(remaining)) {
        await t.query("UPDATE allocations SET quantity=$1 WHERE id=$2", [remaining.toFixed(), alloc.id]);
      }
    }
    await owned(t, "locations", p.locationId, a);
    await t.query("UPDATE contents SET quantity=$1 WHERE id=$2", [
      remaining.toFixed(),
      ct.id,
    ]);
    await t.query("UPDATE boxes SET version=version+1 WHERE id=$1", [id]);
    const result = await services.receipt(t, a, {
      customerId: b.customer_id,
      locationId: p.locationId,
      sourceLabel: "Repacked from " + b.code,
      condition: "good",
      contents: [
        {
          productId: ct.product_id,
          quantity: p.quantity,
          unit: ct.unit,
          verified: true,
          lotId: ct.lot_id || undefined,
          temperatureC: ct.temperature_c,
        },
      ],
    });
    await invalidate(t, a, id);
    await event(t, a, id, "box.repacked", {
      newBoxId: result.id,
      quantity: p.quantity,
      remaining: remaining.toFixed(),
      unit: ct.unit,
      reason: p.reason,
    });
    return { source: await boxState(t, a, id), created: result };
  },
  async splitPackage(t: DB, a: Actor, id: string, p: any) {
    const b = await owned(t, "boxes", id, a, true);
    version(b, p.expectedVersion);
    requireRule(b.status === "confirmed", "BOX_STATE", "Use a confirmed box");
    const ct = await owned(t, "contents", p.contentsId, a, true);
    requireRule(
      ct.box_id === id && ct.verified,
      "CONTENTS",
      "Choose verified contents from this box",
    );

    const splitQty = new Decimal(p.quantity);
    const origQty = new Decimal(ct.quantity);
    const remainingQty = origQty.minus(splitQty);
    requireRule(
      remainingQty.gt(0),
      "REPACK_QUANTITY",
      "Split quantity must be less than source quantity",
    );

    let splitCatchWeight: string | null = null;
    let remainingCatchWeight: string | null = null;
    if (ct.catch_weight && p.catchWeight) {
      const origCw = new Decimal(ct.catch_weight);
      const sCw = new Decimal(p.catchWeight);
      const rCw = origCw.minus(sCw);
      requireRule(
        rCw.gt(0),
        "CATCH_WEIGHT_CONSERVATION",
        "Remaining catch weight must be greater than zero",
      );
      splitCatchWeight = sCw.toFixed(6);
      remainingCatchWeight = rCw.toFixed(6);
    }

    let splitPkgCount: number | null = null;
    let remainingPkgCount: number | null = null;
    if (ct.package_count && p.packageCount) {
      const origPc = ct.package_count;
      const sPc = p.packageCount;
      const rPc = origPc - sPc;
      requireRule(
        rPc > 0,
        "PACKAGE_COUNT_CONSERVATION",
        "Remaining package count must be greater than zero",
      );
      splitPkgCount = sPc;
      remainingPkgCount = rPc;
    }

    await t.query(
      "UPDATE contents SET quantity=$1, catch_weight=COALESCE($2, catch_weight), package_count=COALESCE($3, package_count) WHERE id=$4",
      [remainingQty.toFixed(), remainingCatchWeight, remainingPkgCount, ct.id],
    );
    await t.query("UPDATE boxes SET version=version+1 WHERE id=$1", [id]);

    const targetLoc = p.locationId || b.location_id;
    const result = await services.receipt(t, a, {
      customerId: b.customer_id,
      locationId: targetLoc,
      sourceLabel: "Split from " + b.code,
      condition: "good",
      contents: [
        {
          productId: ct.product_id,
          quantity: splitQty.toFixed(),
          unit: ct.unit,
          verified: true,
          lotId: ct.lot_id || undefined,
          catchWeight: splitCatchWeight || undefined,
          packageCount: splitPkgCount || undefined,
          temperatureC: ct.temperature_c,
        },
      ],
    });

    await invalidate(t, a, id);
    await invalidate(t, a, result.id);

    await event(t, a, id, "package.split", {
      newBoxId: result.id,
      splitQuantity: splitQty.toFixed(),
      remainingQuantity: remainingQty.toFixed(),
      splitCatchWeight,
      remainingCatchWeight,
      splitPackageCount: splitPkgCount,
      remainingPackageCount: remainingPkgCount,
      reason: p.reason,
    });

    return { source: await boxState(t, a, id), created: result };
  },
};
