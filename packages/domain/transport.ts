import { randomUUID as uuid } from 'node:crypto';
import Decimal from 'decimal.js';
import type { DB } from '../database/index.js';
import { driverReassign, deliveryFail, stopCollectReturn } from '../contracts/transport.js';
import { authorize, owned, version, event, type Actor } from './services.js';
import { requireRule } from './index.js';

export async function reassignTripDriver(
  t: DB,
  a: Actor,
  tripId: string,
  payload: unknown,
) {
  authorize(a, 'dispatch');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = driverReassign.parse(payload);
  const trip = await owned(t, 'trips', tripId, a, true);
  version(trip, p.expectedVersion);
  requireRule(trip.status !== 'completed' && trip.status !== 'cancelled', 'TRIP_CLOSED', 'Cannot reassign completed trip', 409);

  const newDriver = await owned(t, 'users', p.newDriverId, a);
  requireRule(
    newDriver.role === 'driver' && newDriver.active,
    'DRIVER_ROLE',
    'Assigned user must have active driver role',
  );

  await t.query('UPDATE trips SET driver_id=$1, version=version+1 WHERE id=$2', [
    newDriver.id,
    tripId,
  ]);

  const reassignmentId = uuid();
  await t.query(
    `INSERT INTO driver_reassignments(id, org_id, warehouse_id, trip_id, previous_driver_id, new_driver_id, reason, actor_id)
     VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      reassignmentId,
      a.org_id,
      a.warehouse_id,
      tripId,
      trip.driver_id,
      newDriver.id,
      p.reason,
      a.id,
    ],
  );

  await event(t, a, tripId, 'trip.driver_reassigned', {
    previousDriverId: trip.driver_id,
    newDriverId: newDriver.id,
    reason: p.reason,
  });

  return owned(t, 'trips', tripId, a);
}

export async function failStopDelivery(
  t: DB,
  a: Actor,
  shipmentId: string,
  payload: unknown,
) {
  const p = deliveryFail.parse(payload);
  const shipment = await owned(t, 'shipments', shipmentId, a, true);
  version(shipment, p.expectedVersion);
  requireRule(
    ['dispatched', 'partial'].includes(shipment.status),
    'SHIPMENT_STATE',
    'Shipment is not currently in delivery custody',
  );

  const trip = await owned(t, 'trips', shipment.trip_id, a, true);
  if (a.role === 'driver') {
    requireRule(trip.driver_id === a.id, 'FORBIDDEN', 'This trip is not assigned to you', 403);
  }

  const lines = (
    await t.query('SELECT * FROM shipment_lines WHERE shipment_id=$1', [shipmentId])
  ).rows;

  for (const line of lines) {
    const unDelivered = new Decimal(line.quantity).minus(line.delivered);
    if (unDelivered.gt(0)) {
      await t.query(
        "UPDATE shipment_lines SET returned=quantity-delivered WHERE id=$1",
        [line.id],
      );
      await t.query(
        "UPDATE boxes SET status='returned', condition='hold', version=version+1 WHERE id=$1",
        [line.box_id],
      );
      await t.query(
        "INSERT INTO issues(id, org_id, box_id, kind, note) VALUES($1, $2, $3, 'failed_delivery', $4)",
        [uuid(), a.org_id, line.box_id, p.reason + (p.note ? ' - ' + p.note : '')],
      );
    }
  }

  await t.query("UPDATE shipments SET status='failed', version=version+1 WHERE id=$1", [shipmentId]);

  await event(t, a, shipmentId, 'delivery.failed', {
    tripId: shipment.trip_id,
    reason: p.reason,
    note: p.note,
  });

  return owned(t, 'shipments', shipmentId, a);
}

export async function collectStopReturn(
  t: DB,
  a: Actor,
  tripId: string,
  payload: unknown,
) {
  const p = stopCollectReturn.parse(payload);
  const trip = await owned(t, 'trips', tripId, a, true);
  requireRule(trip.status === 'in_progress', 'TRIP_STATE', 'Trip must be in progress to collect returns');
  if (a.role === 'driver') {
    requireRule(trip.driver_id === a.id, 'FORBIDDEN', 'This trip is not assigned to you', 403);
  }

  const customer = await owned(t, 'customers', p.customerId, a);
  const product = await owned(t, 'products', p.productId, a);
  requireRule(product.unit === p.unit, 'UNIT_MISMATCH', 'Collection unit must match product base unit');

  const loc = (
    await t.query(
      "SELECT id FROM locations WHERE org_id=$1 AND warehouse_id=$2 AND kind IN ('floor', 'staging') ORDER BY (kind='floor') DESC LIMIT 1",
      [a.org_id, a.warehouse_id],
    )
  ).rows[0];
  const targetLocationId = loc?.id;
  requireRule(targetLocationId, 'LOCATION_REQUIRED', 'Warehouse location required for returned box');

  const boxId = uuid();
  const boxCode = 'RET-' + boxId.slice(0, 8).toUpperCase();
  await t.query(
    `INSERT INTO boxes(id, org_id, warehouse_id, code, customer_id, location_id, pallet_id, status, condition, version)
     VALUES($1, $2, $3, $4, $5, $6, NULL, 'returned', 'hold', 1)`,
    [boxId, a.org_id, a.warehouse_id, boxCode, customer.id, targetLocationId],
  );

  const contentsId = uuid();
  await t.query(
    `INSERT INTO contents(id, org_id, box_id, product_id, quantity, unit, verified)
     VALUES($1, $2, $3, $4, $5, $6, false)`,
    [contentsId, a.org_id, boxId, product.id, p.quantity, p.unit],
  );

  const issueId = uuid();
  await t.query(
    `INSERT INTO issues(id, org_id, box_id, kind, note)
     VALUES($1, $2, $3, 'return disposition', $4)`,
    [issueId, a.org_id, boxId, `Collected at stop ${p.stopId}: ${p.reason}`],
  );

  await event(t, a, boxId, 'delivery.collection_recorded', {
    tripId,
    stopId: p.stopId,
    customerId: customer.id,
    productId: product.id,
    quantity: p.quantity,
    unit: p.unit,
    reason: p.reason,
    boxCode,
  });

  return {
    box: { id: boxId, code: boxCode, status: 'returned', condition: 'hold' },
    boxId,
    boxCode,
    quantity: p.quantity,
    unit: p.unit,
    condition: 'hold',
    status: 'returned',
  };
}

export async function listDriverReassignments(t: DB, a: Actor, tripId: string) {
  authorize(a, 'review');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  return (
    await t.query(
      `SELECT dr.*, u1.name previous_driver_name, u2.name new_driver_name, ua.name actor_name
       FROM driver_reassignments dr
       LEFT JOIN users u1 ON u1.id = dr.previous_driver_id
       JOIN users u2 ON u2.id = dr.new_driver_id
       JOIN users ua ON ua.id = dr.actor_id
       WHERE dr.org_id = $1 AND dr.warehouse_id = $2 AND dr.trip_id = $3
       ORDER BY dr.reassigned_at ASC`,
      [a.org_id, a.warehouse_id, tripId],
    )
  ).rows;
}
