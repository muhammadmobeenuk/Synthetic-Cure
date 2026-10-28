import { randomUUID } from "node:crypto";
import type { DB } from "../database/index.js";
import type { Actor } from "./index.js";
import { requireRule } from "./index.js";
import { owned, event } from "./services.js";

function neutralizeCell(val: any): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (/^[=+\-@\t\r]/.test(s)) {
    return `'${s}`;
  }
  return s;
}

function escapeCsvField(val: any): string {
  const neutralized = neutralizeCell(val);
  if (/[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

export async function bookCarrierManifest(
  db: DB,
  actor: Actor,
  input: {
    tripId: string;
    carrierCode: string;
    carrierName: string;
    serviceLevel?: string;
    trackingReference?: string;
    vehicleTypeRequired?: string;
    specialInstructions?: string;
  },
) {
  requireRule(
    ["dispatcher", "supervisor", "administrator"].includes(actor.role),
    "FORBIDDEN",
    "Only dispatchers or supervisors can book carrier manifests",
    403,
  );

  const trip = await owned(db, "trips", input.tripId, actor);
  requireRule(
    trip.warehouse_id === actor.warehouse_id,
    "WAREHOUSE_MISMATCH",
    "Trip belongs to a different warehouse",
    422,
  );

  const existing = (
    await db.query(
      "SELECT id FROM carrier_manifests WHERE org_id=$1 AND trip_id=$2",
      [actor.org_id, input.tripId],
    )
  ).rows[0];

  requireRule(!existing, "ALREADY_BOOKED", "Carrier manifest already booked for this trip", 409);

  // Compute pallet count, box count, and total weight
  const shipments = (
    await db.query(
      `SELECT s.id, s.order_id, d.name AS destination_name, d.address
       FROM shipments s
       JOIN destinations d ON d.id = s.destination_id
       WHERE s.org_id = $1 AND s.trip_id = $2`,
      [actor.org_id, input.tripId],
    )
  ).rows;

  const boxes = (
    await db.query(
      `SELECT sl.box_id, b.pallet_id, COALESCE(SUM(c.quantity), 0) AS quantity
       FROM shipment_lines sl
       JOIN shipments s ON s.id = sl.shipment_id
       JOIN boxes b ON b.id = sl.box_id
       LEFT JOIN contents c ON c.box_id = b.id
       WHERE s.org_id = $1 AND s.trip_id = $2
       GROUP BY sl.box_id, b.pallet_id`,
      [actor.org_id, input.tripId],
    )
  ).rows;

  const palletIds = new Set(boxes.map((b) => b.pallet_id).filter(Boolean));
  const totalPallets = palletIds.size;
  const totalBoxes = boxes.length;

  const manifestData = {
    tripBusinessDate: trip.business_date,
    shipmentCount: shipments.length,
    palletCount: totalPallets,
    boxCount: totalBoxes,
    shipments: shipments.map((s) => ({
      shipmentId: s.id,
      orderId: s.order_id,
      destinationName: s.destination_name,
      address: s.address,
    })),
  };

  const manifestId = randomUUID();
  await db.query(
    `INSERT INTO carrier_manifests 
     (id, org_id, warehouse_id, trip_id, carrier_code, carrier_name, service_level, tracking_reference, vehicle_type_required, special_instructions, status, manifest_data, total_pallets, total_boxes, booked_at, version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'booked', $11, $12, $13, now(), 1, now(), now())`,
    [
      manifestId,
      actor.org_id,
      actor.warehouse_id,
      input.tripId,
      input.carrierCode,
      input.carrierName,
      input.serviceLevel || null,
      input.trackingReference || null,
      input.vehicleTypeRequired || null,
      input.specialInstructions || null,
      JSON.stringify(manifestData),
      totalPallets,
      totalBoxes,
    ],
  );

  await event(
    db,
    actor,
    manifestId,
    "carrier.manifest_booked",
    {
      tripId: input.tripId,
      carrierCode: input.carrierCode,
      pallets: totalPallets,
      boxes: totalBoxes,
    },
  );

  return {
    id: manifestId,
    tripId: input.tripId,
    carrierCode: input.carrierCode,
    totalPallets,
    totalBoxes,
    status: "booked",
  };
}

export async function getCarrierManifest(db: DB, actor: Actor, tripId: string) {
  const manifest = (
    await db.query(
      `SELECT cm.*, t.business_date, t.vehicle, u.name AS driver_name
       FROM carrier_manifests cm
       JOIN trips t ON t.id = cm.trip_id
       LEFT JOIN users u ON u.id = t.driver_id
       WHERE cm.org_id = $1 AND cm.trip_id = $2`,
      [actor.org_id, tripId],
    )
  ).rows[0];

  requireRule(!!manifest, "NOT_FOUND", "Carrier manifest not found for trip", 404);

  const stops = (
    await db.query(
      `SELECT s.id, s.position, d.name AS destination_name, d.address
       FROM stops s
       JOIN destinations d ON d.id = s.destination_id
       WHERE s.org_id = $1 AND s.trip_id = $2
       ORDER BY s.position, s.id`,
      [actor.org_id, tripId],
    )
  ).rows;

  return {
    ...manifest,
    manifestData: typeof manifest.manifest_data === "string" ? JSON.parse(manifest.manifest_data) : manifest.manifest_data,
    stops,
  };
}

export function exportCarrierManifestCsv(manifest: any): string {
  const headers = [
    "Manifest ID",
    "Carrier Code",
    "Carrier Name",
    "Tracking Ref",
    "Business Date",
    "Stop Position",
    "Destination Name",
    "Destination Address",
    "Total Pallets",
    "Total Boxes",
  ];

  const rows = [headers.map(escapeCsvField).join(",")];

  for (const s of manifest.stops || []) {
    const row = [
      manifest.id,
      manifest.carrier_code,
      manifest.carrier_name,
      manifest.tracking_reference || "",
      manifest.business_date,
      s.position,
      s.destination_name,
      s.address,
      manifest.total_pallets,
      manifest.total_boxes,
    ];
    rows.push(row.map(escapeCsvField).join(","));
  }

  return rows.join("\n");
}

export async function exportAccountingLedger(
  db: DB,
  actor: Actor,
  params: {
    startDate?: string;
    endDate?: string;
    customerId?: string;
    status?: "all" | "delivered" | "fulfilled";
    includeUnconfirmedPricing?: boolean;
  },
) {
  requireRule(
    ["administrator", "supervisor", "reviewer"].includes(actor.role),
    "FORBIDDEN",
    "Accounting export requires supervisor, reviewer, or administrator permissions",
    403,
  );

  const warehouseId = actor.warehouse_id || "__none__";
  let query = `
    SELECT 
      s.id AS shipment_id,
      s.status AS shipment_status,
      s.created_at AS shipment_created_at,
      o.id AS order_id,
      o.code AS order_code,
      c.id AS customer_id,
      c.code AS customer_code,
      c.name AS customer_name,
      d.name AS destination_name,
      d.address AS destination_address,
      sl.id AS shipment_line_id,
      sl.quantity AS shipped_quantity,
      sl.unit AS line_unit,
      p.sku,
      p.name AS product_name,
      p.unit AS base_unit
    FROM shipments s
    JOIN orders o ON o.id = s.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN destinations d ON d.id = s.destination_id
    JOIN shipment_lines sl ON sl.shipment_id = s.id
    JOIN products p ON p.id = sl.product_id
    WHERE s.org_id = $1 AND s.warehouse_id = $2
  `;

  const queryParams: any[] = [actor.org_id, warehouseId];

  if (params.customerId) {
    queryParams.push(params.customerId);
    query += ` AND c.id = $${queryParams.length}`;
  }

  if (params.status === "delivered") {
    query += ` AND s.status = 'delivered'`;
  } else if (params.status === "fulfilled") {
    query += ` AND s.status IN ('delivered', 'dispatched')`;
  }

  if (params.startDate) {
    queryParams.push(params.startDate);
    query += ` AND s.created_at >= $${queryParams.length}::timestamptz`;
  }

  if (params.endDate) {
    queryParams.push(params.endDate + " 23:59:59.999Z");
    query += ` AND s.created_at <= $${queryParams.length}::timestamptz`;
  }

  query += ` ORDER BY s.created_at DESC, s.id, sl.id LIMIT 2000`;

  const rows = (await db.query(query, queryParams)).rows;

  return {
    disclaimer: "PHYSICAL QUANTITIES ONLY · COMMERCIAL PRICING UNCONFIRMED",
    extractedAt: new Date().toISOString(),
    recordCount: rows.length,
    records: rows,
  };
}

export function exportAccountingCsv(data: { disclaimer: string; records: any[] }): string {
  const disclaimerLine = `# DISCLAIMER: ${neutralizeCell(data.disclaimer || "PHYSICAL QUANTITIES ONLY · COMMERCIAL PRICING UNCONFIRMED")}`;
  const headers = [
    "Shipment ID",
    "Shipment Status",
    "Date",
    "Order Code",
    "Customer Code",
    "Customer Name",
    "Destination Name",
    "SKU",
    "Product Name",
    "Physical Quantity",
    "Unit",
    "Commercial Pricing Status",
  ];

  const rows = [
    disclaimerLine,
    headers.map(escapeCsvField).join(","),
  ];

  for (const r of data.records) {
    const row = [
      r.shipment_id,
      r.shipment_status,
      r.shipment_created_at ? new Date(r.shipment_created_at).toISOString().split("T")[0] : "",
      r.order_code,
      r.customer_code,
      r.customer_name,
      r.destination_name,
      r.sku,
      r.product_name,
      r.shipped_quantity,
      r.line_unit,
      "UNCONFIRMED_PHYSICAL_ONLY",
    ];
    rows.push(row.map(escapeCsvField).join(","));
  }

  return rows.join("\n");
}
