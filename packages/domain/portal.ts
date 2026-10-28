import { randomUUID } from "node:crypto";
import type { DB } from "../database/index.js";
import type { Actor } from "./index.js";
import { requireRule } from "./index.js";
import { owned, event } from "./services.js";

export async function getPortalContext(db: DB, actor: Actor) {
  const portalUser = (
    await db.query(
      "SELECT * FROM client_portal_users WHERE org_id=$1 AND user_id=$2 AND active=true",
      [actor.org_id, actor.id],
    )
  ).rows[0];

  requireRule(
    !!portalUser,
    "PORTAL_ACCESS_DENIED",
    "User is not registered for client portal access",
    403,
  );

  return {
    portalUserId: portalUser.id,
    customerId: portalUser.customer_id as string | null,
    stockOwnerId: portalUser.stock_owner_id as string | null,
  };
}

export async function linkPortalUser(
  db: DB,
  actor: Actor,
  input: {
    userId: string;
    customerId?: string | null;
    stockOwnerId?: string | null;
    reason: string;
  },
) {
  requireRule(
    ["administrator", "supervisor"].includes(actor.role),
    "FORBIDDEN",
    "Only supervisors or administrators can link client portal users",
    403,
  );

  const targetUser = (
    await db.query(
      `SELECT u.id, u.active, m.role, m.active AS membership_active
       FROM users u
       JOIN company_memberships m ON m.user_id = u.id
       WHERE u.id = $1 AND m.org_id = $2`,
      [input.userId, actor.org_id],
    )
  ).rows[0];
  requireRule(targetUser, "NOT_FOUND", "Target user not found in company", 404);
  requireRule(targetUser.active && targetUser.membership_active, "USER_INACTIVE", "Target user is inactive", 422);

  if (input.customerId) {
    await owned(db, "customers", input.customerId, actor);
  }
  if (input.stockOwnerId) {
    await owned(db, "stock_owners", input.stockOwnerId, actor);
  }

  const existing = (
    await db.query(
      "SELECT id, version FROM client_portal_users WHERE org_id=$1 AND user_id=$2",
      [actor.org_id, input.userId],
    )
  ).rows[0];

  let recordId: string;
  if (existing) {
    await db.query(
      `UPDATE client_portal_users 
       SET customer_id=$1, stock_owner_id=$2, active=true, updated_at=now(), version=version+1 
       WHERE id=$3`,
      [input.customerId || null, input.stockOwnerId || null, existing.id],
    );
    recordId = existing.id;
  } else {
    recordId = randomUUID();
    await db.query(
      `INSERT INTO client_portal_users (id, org_id, user_id, customer_id, stock_owner_id, active, created_at, updated_at, version)
       VALUES ($1, $2, $3, $4, $5, true, now(), now(), 1)`,
      [recordId, actor.org_id, input.userId, input.customerId || null, input.stockOwnerId || null],
    );
  }

  await event(
    db,
    actor,
    recordId,
    "portal.user_linked",
    {
      userId: input.userId,
      customerId: input.customerId,
      stockOwnerId: input.stockOwnerId,
      reason: input.reason,
    },
  );

  return { id: recordId, status: "linked" };
}

export async function getPortalInventory(db: DB, actor: Actor) {
  const ctx = await getPortalContext(db, actor);

  if (ctx.stockOwnerId) {
    const balances = (
      await db.query(
        `SELECT b.*, p.name AS product_name, p.sku, p.unit AS base_unit
         FROM inventory_balances b
         JOIN products p ON p.id = b.product_id
         WHERE b.org_id = $1 AND b.stock_owner_id = $2
         ORDER BY p.name, b.id`,
        [actor.org_id, ctx.stockOwnerId],
      )
    ).rows;
    return { stockOwnerId: ctx.stockOwnerId, balances };
  }

  // Customer inventory balances
  const balances = (
    await db.query(
      `SELECT c.product_id, p.name AS product_name, p.sku, p.unit AS base_unit,
              COALESCE(SUM(c.quantity), 0)::text AS on_hand_quantity,
              COUNT(DISTINCT b.id)::int AS box_count
       FROM boxes b
       JOIN contents c ON c.box_id = b.id
       JOIN products p ON p.id = c.product_id
       WHERE b.org_id = $1 AND b.customer_id = $2 AND b.status IN ('received', 'stored', 'allocated')
       GROUP BY c.product_id, p.name, p.sku, p.unit
       ORDER BY p.name`,
      [actor.org_id, ctx.customerId],
    )
  ).rows;

  return { customerId: ctx.customerId, balances };
}

export async function getPortalOrders(db: DB, actor: Actor) {
  const ctx = await getPortalContext(db, actor);
  requireRule(!!ctx.customerId, "CUSTOMER_REQUIRED", "Portal orders require an assigned customer account", 403);

  const orders = (
    await db.query(
      `SELECT o.*, d.name AS destination_name, d.address AS destination_address
       FROM orders o
       JOIN destinations d ON d.id = o.destination_id
       WHERE o.org_id = $1 AND o.customer_id = $2
       ORDER BY o.created_at DESC, o.id
       LIMIT 100`,
      [actor.org_id, ctx.customerId],
    )
  ).rows;

  const orderIds = orders.map((o) => o.id);
  let lines: any[] = [];
  if (orderIds.length > 0) {
    lines = (
      await db.query(
        `SELECT ol.*, p.name AS product_name, p.sku
         FROM order_lines ol
         JOIN products p ON p.id = ol.product_id
         WHERE ol.org_id = $1 AND ol.order_id = ANY($2::varchar[])
         ORDER BY ol.id`,
        [actor.org_id, orderIds],
      )
    ).rows;
  }

  const linesByOrder = new Map<string, any[]>();
  for (const l of lines) {
    if (!linesByOrder.has(l.order_id)) linesByOrder.set(l.order_id, []);
    linesByOrder.get(l.order_id)!.push(l);
  }

  return orders.map((o) => ({
    ...o,
    lines: linesByOrder.get(o.id) || [],
  }));
}

export async function submitPortalDraftOrder(
  db: DB,
  actor: Actor,
  input: {
    destinationId: string;
    lines: Array<{ productId: string; quantity: string; unit: string }>;
    customerReference?: string;
    note?: string;
  },
) {
  const ctx = await getPortalContext(db, actor);
  requireRule(!!ctx.customerId, "CUSTOMER_REQUIRED", "Submitting orders requires an assigned customer account", 403);

  const destination = (
    await db.query(
      `SELECT d.* FROM destinations d
       JOIN destination_authorizations da ON da.destination_id = d.id
       WHERE d.org_id = $1 AND d.id = $2 AND da.customer_id = $3`,
      [actor.org_id, input.destinationId, ctx.customerId],
    )
  ).rows[0];

  requireRule(
    !!destination,
    "DESTINATION_UNAUTHORIZED",
    "Destination is not authorized for this customer account",
    422,
  );

  const warehouseId = actor.warehouse_id || (
    await db.query("SELECT id FROM warehouses WHERE org_id=$1 ORDER BY created_at LIMIT 1", [actor.org_id])
  ).rows[0]?.id;

  requireRule(!!warehouseId, "WAREHOUSE_REQUIRED", "No active warehouse configured for order entry", 422);

  const orderId = randomUUID();
  const code = "ORD-CL-" + Math.floor(100000 + Math.random() * 900000);

  await db.query(
    `INSERT INTO orders (id, org_id, warehouse_id, code, customer_id, destination_id, status, partial_approved, version, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft', false, 1, now())`,
    [
      orderId,
      actor.org_id,
      warehouseId,
      code,
      ctx.customerId,
      input.destinationId,
    ],
  );

  for (const line of input.lines) {
    const product = await owned(db, "products", line.productId, actor);
    requireRule(
      product.unit.toLowerCase() === line.unit.toLowerCase(),
      "UNIT_MISMATCH",
      `Unit mismatch for ${product.name}: product unit is ${product.unit}`,
      422,
    );

    const lineId = randomUUID();
    await db.query(
      `INSERT INTO order_lines (id, org_id, warehouse_id, order_id, product_id, quantity, unit)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [lineId, actor.org_id, warehouseId, orderId, line.productId, line.quantity, line.unit],
    );
  }

  await event(
    db,
    actor,
    orderId,
    "portal.order_submitted",
    {
      orderCode: code,
      customerId: ctx.customerId,
      destinationId: input.destinationId,
      lineCount: input.lines.length,
    },
  );

  return { id: orderId, code, status: "draft" };
}

export async function getPortalShipments(db: DB, actor: Actor) {
  const ctx = await getPortalContext(db, actor);
  requireRule(!!ctx.customerId, "CUSTOMER_REQUIRED", "Shipments tracking requires an assigned customer account", 403);

  const shipments = (
    await db.query(
      `SELECT s.*, o.code AS order_code, d.name AS destination_name, d.address AS destination_address,
              t.business_date AS trip_date, t.vehicle AS trip_vehicle
       FROM shipments s
       JOIN orders o ON o.id = s.order_id
       JOIN destinations d ON d.id = s.destination_id
       LEFT JOIN trips t ON t.id = s.trip_id
       WHERE s.org_id = $1 AND o.customer_id = $2
       ORDER BY s.created_at DESC, s.id
       LIMIT 100`,
      [actor.org_id, ctx.customerId],
    )
  ).rows;

  return shipments;
}
