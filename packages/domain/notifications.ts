import { randomUUID, createHmac, randomBytes } from "node:crypto";
import type { DB } from "../database/index.js";
import type { Actor } from "./index.js";
import { requireRule } from "./index.js";
import { owned, event } from "./services.js";

export function signPayload(secret: string, payload: any): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(typeof payload === "string" ? payload : JSON.stringify(payload));
  return "sha256=" + hmac.digest("hex");
}

export async function listNotificationEndpoints(db: DB, actor: Actor) {
  const warehouseId = actor.warehouse_id || "__none__";
  const endpoints = (
    await db.query(
      `SELECT id, url, event_topics, description, active, created_at, updated_at, version
       FROM notification_endpoints
       WHERE org_id = $1 AND (warehouse_id = $2 OR warehouse_id IS NULL)
       ORDER BY created_at DESC, id`,
      [actor.org_id, warehouseId],
    )
  ).rows;

  return endpoints.map((e) => ({
    ...e,
    eventTopics: typeof e.event_topics === "string" ? JSON.parse(e.event_topics) : e.event_topics,
  }));
}

export async function createNotificationEndpoint(
  db: DB,
  actor: Actor,
  input: {
    url: string;
    eventTopics: string[];
    secret?: string;
    description?: string;
    active?: boolean;
  },
) {
  requireRule(
    ["administrator", "supervisor"].includes(actor.role),
    "FORBIDDEN",
    "Only administrators or supervisors can configure webhook endpoints",
    403,
  );

  const endpointId = randomUUID();
  const secret = input.secret || randomBytes(24).toString("hex");
  const warehouseId = actor.warehouse_id || null;

  await db.query(
    `INSERT INTO notification_endpoints (id, org_id, warehouse_id, url, event_topics, secret, description, active, created_at, updated_at, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), 1)`,
    [
      endpointId,
      actor.org_id,
      warehouseId,
      input.url,
      JSON.stringify(input.eventTopics),
      secret,
      input.description || null,
      input.active !== false,
    ],
  );

  await event(
    db,
    actor,
    endpointId,
    "notification.endpoint_created",
    { url: input.url, topics: input.eventTopics },
  );

  return {
    id: endpointId,
    url: input.url,
    eventTopics: input.eventTopics,
    secret,
    active: input.active !== false,
  };
}

export async function updateNotificationEndpoint(
  db: DB,
  actor: Actor,
  input: {
    id: string;
    expectedVersion: number;
    url?: string;
    eventTopics?: string[];
    secret?: string;
    active?: boolean;
    reason: string;
  },
) {
  requireRule(
    ["administrator", "supervisor"].includes(actor.role),
    "FORBIDDEN",
    "Only administrators or supervisors can update webhook endpoints",
    403,
  );

  const existing = await owned(db, "notification_endpoints", input.id, actor);
  requireRule(
    existing.version === input.expectedVersion,
    "VERSION_CONFLICT",
    "Endpoint modified by another user",
    409,
  );

  const url = input.url || existing.url;
  const eventTopics = input.eventTopics ? JSON.stringify(input.eventTopics) : existing.event_topics;
  const secret = input.secret || existing.secret;
  const active = input.active !== undefined ? input.active : existing.active;

  await db.query(
    `UPDATE notification_endpoints
     SET url = $1, event_topics = $2, secret = $3, active = $4, updated_at = now(), version = version + 1
     WHERE id = $5`,
    [url, eventTopics, secret, active, input.id],
  );

  await event(
    db,
    actor,
    input.id,
    "notification.endpoint_updated",
    { reason: input.reason, active, url },
  );

  return { id: input.id, status: "updated" };
}

export async function dispatchWebhookEvent(
  db: DB,
  orgId: string,
  warehouseId: string | null,
  topic: string,
  payload: any,
) {
  const endpoints = (
    await db.query(
      `SELECT * FROM notification_endpoints
       WHERE org_id = $1 AND active = true AND (warehouse_id = $2 OR warehouse_id IS NULL)`,
      [orgId, warehouseId || "__none__"],
    )
  ).rows;

  const matchingEndpoints = endpoints.filter((e) => {
    const topics: string[] = typeof e.event_topics === "string" ? JSON.parse(e.event_topics) : e.event_topics;
    return topics.includes(topic) || topics.includes("*");
  });

  const deliveries: Array<{ id: string; endpointId: string; status: string }> = [];

  for (const ep of matchingEndpoints) {
    const deliveryId = randomUUID();
    const signature = signPayload(ep.secret, payload);

    await db.query(
      `INSERT INTO notification_deliveries (id, org_id, warehouse_id, endpoint_id, event_topic, payload, signature, status, attempts, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 1, now())`,
      [
        deliveryId,
        orgId,
        warehouseId,
        ep.id,
        topic,
        JSON.stringify(payload),
        signature,
      ],
    );

    deliveries.push({ id: deliveryId, endpointId: ep.id, status: "pending" });
  }

  return deliveries;
}

export async function testNotificationEndpoint(
  db: DB,
  actor: Actor,
  input: { endpointId: string },
) {
  const ep = await owned(db, "notification_endpoints", input.endpointId, actor);
  const deliveryId = randomUUID();
  const testPayload = {
    event: "test.ping",
    timestamp: new Date().toISOString(),
    organizationId: actor.org_id,
    warehouseId: actor.warehouse_id,
    actorName: actor.name,
    message: "Synthetic Cure WMS Webhook Verification Ping",
  };

  const signature = signPayload(ep.secret, testPayload);

  await db.query(
    `INSERT INTO notification_deliveries (id, org_id, warehouse_id, endpoint_id, event_topic, payload, signature, status, status_code, attempts, created_at, delivered_at)
     VALUES ($1, $2, $3, $4, 'test.ping', $5, $6, 'delivered', 200, 1, now(), now())`,
    [
      deliveryId,
      actor.org_id,
      actor.warehouse_id,
      ep.id,
      JSON.stringify(testPayload),
      signature,
    ],
  );

  return {
    deliveryId,
    endpointId: ep.id,
    signature,
    status: "delivered",
    payload: testPayload,
  };
}

export async function listNotificationDeliveries(
  db: DB,
  actor: Actor,
  endpointId?: string,
) {
  const warehouseId = actor.warehouse_id || "__none__";
  let query = `SELECT d.*, e.url AS endpoint_url
               FROM notification_deliveries d
               JOIN notification_endpoints e ON e.id = d.endpoint_id
               WHERE d.org_id = $1 AND (d.warehouse_id = $2 OR d.warehouse_id IS NULL)`;
  const params: any[] = [actor.org_id, warehouseId];

  if (endpointId) {
    query += " AND d.endpoint_id = $3";
    params.push(endpointId);
  }

  query += " ORDER BY d.created_at DESC, d.id LIMIT 100";
  return (await db.query(query, params)).rows;
}
