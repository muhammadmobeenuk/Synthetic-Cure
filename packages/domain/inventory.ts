import { randomUUID as uuid } from 'node:crypto';
import Decimal from 'decimal.js';
import type { DB } from '../database/index.js';
import {
  ownerCreate,
  unitConversionCreate,
  inventoryAdjust,
  inventoryMove,
  inventoryReserve,
  inventoryRelease,
} from '../contracts/inventory.js';
import { authorize, owned, version, event, type Actor } from './services.js';
import { requireRule, DomainError } from './index.js';

export async function listStockOwners(t: DB, a: Actor) {
  authorize(a, 'review');
  const rows = (
    await t.query(
      'SELECT * FROM stock_owners WHERE org_id=$1 ORDER BY code, id LIMIT 200',
      [a.org_id],
    )
  ).rows;
  return rows;
}

export async function createStockOwner(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'configure');
  const p = ownerCreate.parse(payload);
  const existing = (
    await t.query(
      'SELECT id FROM stock_owners WHERE org_id=$1 AND code=$2',
      [a.org_id, p.code],
    )
  ).rows[0];
  requireRule(!existing, 'DUPLICATE_OWNER', 'Stock owner code already exists', 409);
  const id = uuid();
  await t.query(
    'INSERT INTO stock_owners(id, org_id, code, name) VALUES($1, $2, $3, $4)',
    [id, a.org_id, p.code, p.name],
  );
  await event(t, a, id, 'stock_owner.created', { code: p.code, name: p.name });
  return owned(t, 'stock_owners', id, a);
}

export async function listUnitConversions(t: DB, a: Actor, productId: string) {
  authorize(a, 'review');
  await owned(t, 'products', productId, a);
  const rows = (
    await t.query(
      'SELECT * FROM product_unit_conversions WHERE org_id=$1 AND product_id=$2 ORDER BY from_unit, to_unit',
      [a.org_id, productId],
    )
  ).rows;
  return rows;
}

export async function createUnitConversion(
  t: DB,
  a: Actor,
  productId: string,
  payload: unknown,
) {
  authorize(a, 'configure');
  const p = unitConversionCreate.parse(payload);
  const prod = await owned(t, 'products', productId, a);
  requireRule(
    p.fromUnit !== p.toUnit,
    'IDENTICAL_UNITS',
    'From and to units must be distinct',
    422,
  );
  const id = uuid();
  await t.query(
    'INSERT INTO product_unit_conversions(id, org_id, product_id, from_unit, to_unit, factor, verified) VALUES($1, $2, $3, $4, $5, $6, $7) ON CONFLICT(org_id, product_id, from_unit, to_unit) DO UPDATE SET factor=$6, verified=$7',
    [id, a.org_id, prod.id, p.fromUnit, p.toUnit, p.factor, p.verified],
  );
  await event(t, a, id, 'unit_conversion.created', {
    productId: prod.id,
    fromUnit: p.fromUnit,
    toUnit: p.toUnit,
    factor: p.factor,
    verified: p.verified,
  });
  return (
    await t.query(
      'SELECT * FROM product_unit_conversions WHERE org_id=$1 AND product_id=$2 AND from_unit=$3 AND to_unit=$4',
      [a.org_id, prod.id, p.fromUnit, p.toUnit],
    )
  ).rows[0];
}

export async function convertProductQuantity(
  t: DB,
  orgId: string,
  productId: string,
  quantityStr: string,
  fromUnit: string,
  toUnit: string,
): Promise<{ convertedQuantity: string; factor: string }> {
  if (fromUnit === toUnit) {
    return { convertedQuantity: quantityStr, factor: '1' };
  }
  const direct = (
    await t.query(
      'SELECT factor, verified FROM product_unit_conversions WHERE org_id=$1 AND product_id=$2 AND from_unit=$3 AND to_unit=$4',
      [orgId, productId, fromUnit, toUnit],
    )
  ).rows[0];
  if (direct && direct.verified) {
    const factorDec = new Decimal(direct.factor);
    const converted = new Decimal(quantityStr).times(factorDec).toFixed(6);
    return { convertedQuantity: converted, factor: direct.factor };
  }
  const reverse = (
    await t.query(
      'SELECT factor, verified FROM product_unit_conversions WHERE org_id=$1 AND product_id=$2 AND from_unit=$3 AND to_unit=$4',
      [orgId, productId, toUnit, fromUnit],
    )
  ).rows[0];
  if (reverse && reverse.verified) {
    const factorDec = new Decimal(reverse.factor);
    const converted = new Decimal(quantityStr).dividedBy(factorDec).toFixed(6);
    return { convertedQuantity: converted, factor: new Decimal(1).dividedBy(factorDec).toFixed(6) };
  }
  throw new DomainError(
    422,
    'UNKNOWN_CONVERSION',
    `Unknown unit conversion between ${fromUnit} and ${toUnit} for product. Unknown conversion is not zero and must not create item or weight totals.`,
  );
}

export async function getInventoryBalances(
  t: DB,
  a: Actor,
  filters?: { productId?: string; locationId?: string; ownerId?: string },
) {
  authorize(a, 'review');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  let sql = `
    SELECT b.*, p.sku, p.name product_name, p.name_zh, l.code location_code, o.name owner_name, o.code owner_code
    FROM inventory_balances b
    JOIN products p ON p.id = b.product_id AND p.org_id = b.org_id
    JOIN locations l ON l.id = b.location_id AND l.warehouse_id = b.warehouse_id
    JOIN stock_owners o ON o.id = b.owner_id AND o.org_id = b.org_id
    WHERE b.org_id = $1 AND b.warehouse_id = $2
  `;
  const params: any[] = [a.org_id, a.warehouse_id];
  if (filters?.productId) {
    params.push(filters.productId);
    sql += ` AND b.product_id = $${params.length}`;
  }
  if (filters?.locationId) {
    params.push(filters.locationId);
    sql += ` AND b.location_id = $${params.length}`;
  }
  if (filters?.ownerId) {
    params.push(filters.ownerId);
    sql += ` AND b.owner_id = $${params.length}`;
  }
  sql += ' ORDER BY p.sku, l.code, b.unit LIMIT 200';
  return (await t.query(sql, params)).rows;
}

export async function getInventoryLedger(
  t: DB,
  a: Actor,
  filters?: { productId?: string; locationId?: string; ownerId?: string; limit?: number },
) {
  authorize(a, 'review');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  let sql = `
    SELECT l.*, p.sku, p.name product_name, loc.code location_code, o.name owner_name, u.name actor_name
    FROM inventory_ledger l
    JOIN products p ON p.id = l.product_id AND p.org_id = l.org_id
    JOIN locations loc ON loc.id = l.location_id AND loc.warehouse_id = l.warehouse_id
    JOIN stock_owners o ON o.id = l.owner_id AND o.org_id = l.org_id
    JOIN users u ON u.id = l.actor_id
    WHERE l.org_id = $1 AND l.warehouse_id = $2
  `;
  const params: any[] = [a.org_id, a.warehouse_id];
  if (filters?.productId) {
    params.push(filters.productId);
    sql += ` AND l.product_id = $${params.length}`;
  }
  if (filters?.locationId) {
    params.push(filters.locationId);
    sql += ` AND l.location_id = $${params.length}`;
  }
  if (filters?.ownerId) {
    params.push(filters.ownerId);
    sql += ` AND l.owner_id = $${params.length}`;
  }
  const lim = Math.min(filters?.limit || 100, 200);
  params.push(lim);
  sql += ` ORDER BY l.created_at DESC, l.id DESC LIMIT $${params.length}`;
  return (await t.query(sql, params)).rows;
}

async function resolveOwner(t: DB, orgId: string, ownerIdInput?: string) {
  const defaultOwnerId = `${orgId}:default_owner`;
  const targetId = ownerIdInput || defaultOwnerId;
  let owner = (await t.query('SELECT * FROM stock_owners WHERE id=$1 AND org_id=$2', [targetId, orgId])).rows[0];
  if (!owner && targetId === defaultOwnerId) {
    await t.query("INSERT INTO stock_owners(id, org_id, code, name) VALUES($1, $2, 'DEFAULT', 'Primary Owner') ON CONFLICT DO NOTHING", [defaultOwnerId, orgId]);
    owner = (await t.query('SELECT * FROM stock_owners WHERE id=$1 AND org_id=$2', [defaultOwnerId, orgId])).rows[0];
  }
  requireRule(owner, 'NOT_FOUND', 'Stock owner not found', 404);
  return owner;
}

export async function adjustInventory(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'adjust');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = inventoryAdjust.parse(payload);
  const prod = await owned(t, 'products', p.productId, a);
  const loc = await owned(t, 'locations', p.locationId, a);
  const owner = await resolveOwner(t, a.org_id, p.ownerId);
  const ownerId = owner.id;

  requireRule(
    prod.unit === p.unit,
    'UNIT_MISMATCH',
    `Use product base unit ${prod.unit}`,
    422,
  );

  const delta = new Decimal(p.quantityDelta);

  // Lock existing balance row if exists
  const existingRes = await t.query(
    'SELECT * FROM inventory_balances WHERE org_id=$1 AND warehouse_id=$2 AND product_id=$3 AND location_id=$4 AND owner_id=$5 AND unit=$6 FOR UPDATE',
    [a.org_id, a.warehouse_id, prod.id, loc.id, ownerId, p.unit],
  );
  let bal = existingRes.rows[0];

  if (!bal) {
    if (delta.lt(0)) {
      throw new DomainError(
        409,
        'INSUFFICIENT_STOCK',
        'Cannot reduce stock below zero on an empty balance',
      );
    }
    const newId = uuid();
    const onHand = delta.toFixed(6);
    const available = p.state === 'held' ? '0' : onHand;
    const held = p.state === 'held' ? onHand : '0';
    await t.query(
      `INSERT INTO inventory_balances(id, org_id, warehouse_id, product_id, location_id, owner_id, unit, on_hand, reserved, available, picked, in_transit, held, dispatched, version)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, 0, 0, $10, 0, 1)`,
      [newId, a.org_id, a.warehouse_id, prod.id, loc.id, ownerId, p.unit, onHand, available, held],
    );
    bal = (
      await t.query('SELECT * FROM inventory_balances WHERE id=$1', [newId])
    ).rows[0];
  } else {
    const curOnHand = new Decimal(bal.on_hand);
    const curReserved = new Decimal(bal.reserved);
    const curAvailable = new Decimal(bal.available);
    const curPicked = new Decimal(bal.picked);
    const curInTransit = new Decimal(bal.in_transit);
    const curHeld = new Decimal(bal.held);
    const curDispatched = new Decimal(bal.dispatched);

    let nextOnHand = curOnHand;
    let nextAvailable = curAvailable;
    let nextHeld = curHeld;

    if (delta.gt(0)) {
      nextOnHand = curOnHand.plus(delta);
      if (p.state === 'held') {
        nextHeld = curHeld.plus(delta);
      } else {
        nextAvailable = curAvailable.plus(delta);
      }
    } else {
      const absDelta = delta.abs();
      if (p.state === 'held') {
        requireRule(
          curHeld.gte(absDelta),
          'INSUFFICIENT_STOCK',
          'Insufficient held stock to reduce',
          409,
        );
        nextHeld = curHeld.minus(absDelta);
        nextOnHand = curOnHand.minus(absDelta);
      } else {
        requireRule(
          curAvailable.gte(absDelta),
          'INSUFFICIENT_STOCK',
          'Insufficient available stock to reduce',
          409,
        );
        nextAvailable = curAvailable.minus(absDelta);
        nextOnHand = curOnHand.minus(absDelta);
      }
    }

    requireRule(nextOnHand.gte(0), 'NEGATIVE_STOCK', 'Stock cannot be negative', 409);
    requireRule(
      nextAvailable.equals(nextOnHand.minus(curReserved).minus(curPicked).minus(nextHeld)),
      'COHERENCE_ERROR',
      'Inventory balance invariant failed: available must equal on_hand - reserved - picked - held',
      500,
    );

    await t.query(
      `UPDATE inventory_balances
       SET on_hand=$1, available=$2, held=$3, version=version+1, updated_at=now()
       WHERE id=$4`,
      [nextOnHand.toFixed(6), nextAvailable.toFixed(6), nextHeld.toFixed(6), bal.id],
    );
    bal = (
      await t.query('SELECT * FROM inventory_balances WHERE id=$1', [bal.id])
    ).rows[0];
  }

  // Insert ledger record
  const ledgerId = uuid();
  await t.query(
    `INSERT INTO inventory_ledger(id, org_id, warehouse_id, product_id, location_id, owner_id, box_id, quantity_delta, unit, state, reference_type, reference_id, notes, actor_id)
     VALUES($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, 'adjustment', $10, $11, $12)`,
    [
      ledgerId,
      a.org_id,
      a.warehouse_id,
      prod.id,
      loc.id,
      ownerId,
      delta.toFixed(6),
      p.unit,
      p.state,
      bal.id,
      p.reason,
      a.id,
    ],
  );

  await event(t, a, bal.id, 'inventory.adjusted', {
    balanceId: bal.id,
    productId: prod.id,
    locationId: loc.id,
    ownerId,
    delta: delta.toFixed(6),
    unit: p.unit,
    reason: p.reason,
  });

  return bal;
}

export async function moveInventory(
  t: DB,
  a: Actor,
  balanceId: string,
  payload: unknown,
) {
  authorize(a, 'adjust');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = inventoryMove.parse(payload);
  const bal = await owned(t, 'inventory_balances', balanceId, a, true);
  version(bal, p.expectedVersion);
  requireRule(
    bal.location_id === p.sourceLocationId,
    'LOCATION_MISMATCH',
    'Balance location does not match source location',
    422,
  );
  const destLoc = await owned(t, 'locations', p.destinationLocationId, a);
  const moveQty = new Decimal(p.quantity);
  const curAvailable = new Decimal(bal.available);
  const curOnHand = new Decimal(bal.on_hand);
  requireRule(
    curAvailable.gte(moveQty),
    'INSUFFICIENT_AVAILABLE',
    'Cannot move more than available unreserved stock',
    409,
  );

  // Decrement source
  const srcOnHand = curOnHand.minus(moveQty);
  const srcAvail = curAvailable.minus(moveQty);
  await t.query(
    'UPDATE inventory_balances SET on_hand=$1, available=$2, version=version+1, updated_at=now() WHERE id=$3',
    [srcOnHand.toFixed(6), srcAvail.toFixed(6), bal.id],
  );

  // Increment destination
  const destBalRes = await t.query(
    'SELECT * FROM inventory_balances WHERE org_id=$1 AND warehouse_id=$2 AND product_id=$3 AND location_id=$4 AND owner_id=$5 AND unit=$6 FOR UPDATE',
    [a.org_id, a.warehouse_id, bal.product_id, destLoc.id, bal.owner_id, bal.unit],
  );
  let destBal = destBalRes.rows[0];
  if (!destBal) {
    const newId = uuid();
    await t.query(
      `INSERT INTO inventory_balances(id, org_id, warehouse_id, product_id, location_id, owner_id, unit, on_hand, reserved, available, picked, in_transit, held, dispatched, version)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, 0, $8, 0, 0, 0, 0, 1)`,
      [newId, a.org_id, a.warehouse_id, bal.product_id, destLoc.id, bal.owner_id, bal.unit, moveQty.toFixed(6)],
    );
    destBal = (
      await t.query('SELECT * FROM inventory_balances WHERE id=$1', [newId])
    ).rows[0];
  } else {
    const destOnHand = new Decimal(destBal.on_hand).plus(moveQty);
    const destAvail = new Decimal(destBal.available).plus(moveQty);
    await t.query(
      'UPDATE inventory_balances SET on_hand=$1, available=$2, version=version+1, updated_at=now() WHERE id=$3',
      [destOnHand.toFixed(6), destAvail.toFixed(6), destBal.id],
    );
  }

  // Ledger records for source and dest
  await t.query(
    `INSERT INTO inventory_ledger(id, org_id, warehouse_id, product_id, location_id, owner_id, quantity_delta, unit, state, reference_type, reference_id, notes, actor_id)
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, 'available', 'move_out', $9, $10, $11)`,
    [
      uuid(),
      a.org_id,
      a.warehouse_id,
      bal.product_id,
      bal.location_id,
      bal.owner_id,
      moveQty.negated().toFixed(6),
      bal.unit,
      destBal.id,
      p.reason,
      a.id,
    ],
  );
  await t.query(
    `INSERT INTO inventory_ledger(id, org_id, warehouse_id, product_id, location_id, owner_id, quantity_delta, unit, state, reference_type, reference_id, notes, actor_id)
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, 'available', 'move_in', $9, $10, $11)`,
    [
      uuid(),
      a.org_id,
      a.warehouse_id,
      bal.product_id,
      destLoc.id,
      bal.owner_id,
      moveQty.toFixed(6),
      bal.unit,
      bal.id,
      p.reason,
      a.id,
    ],
  );

  await event(t, a, bal.id, 'inventory.moved', {
    sourceBalanceId: bal.id,
    destBalanceId: destBal.id,
    quantity: moveQty.toFixed(6),
    reason: p.reason,
  });

  return { source: await owned(t, 'inventory_balances', bal.id, a), destination: destBal };
}

export async function reserveInventory(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'prepare');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = inventoryReserve.parse(payload);
  const prod = await owned(t, 'products', p.productId, a);
  const loc = await owned(t, 'locations', p.locationId, a);
  const owner = await resolveOwner(t, a.org_id, p.ownerId);
  const ownerId = owner.id;
  const reqQty = new Decimal(p.quantity);

  const balRes = await t.query(
    'SELECT * FROM inventory_balances WHERE org_id=$1 AND warehouse_id=$2 AND product_id=$3 AND location_id=$4 AND owner_id=$5 AND unit=$6 FOR UPDATE',
    [a.org_id, a.warehouse_id, prod.id, loc.id, ownerId, p.unit],
  );
  const bal = balRes.rows[0];
  requireRule(bal, 'NOT_FOUND', 'No stock balance found for reservation', 404);

  const curAvailable = new Decimal(bal.available);
  requireRule(
    curAvailable.gte(reqQty),
    'INSUFFICIENT_STOCK',
    'Cannot reserve more than currently available stock; reservations do not create stock',
    409,
  );

  const nextAvailable = curAvailable.minus(reqQty);
  const nextReserved = new Decimal(bal.reserved).plus(reqQty);

  await t.query(
    'UPDATE inventory_balances SET available=$1, reserved=$2, version=version+1, updated_at=now() WHERE id=$3',
    [nextAvailable.toFixed(6), nextReserved.toFixed(6), bal.id],
  );

  await t.query(
    `INSERT INTO inventory_ledger(id, org_id, warehouse_id, product_id, location_id, owner_id, quantity_delta, unit, state, reference_type, reference_id, notes, actor_id)
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, 'reserved', 'reserve', $9, $10, $11)`,
    [
      uuid(),
      a.org_id,
      a.warehouse_id,
      prod.id,
      loc.id,
      ownerId,
      reqQty.toFixed(6),
      p.unit,
      p.orderLineId || bal.id,
      p.reason,
      a.id,
    ],
  );

  await event(t, a, bal.id, 'inventory.reserved', {
    balanceId: bal.id,
    quantity: reqQty.toFixed(6),
    orderLineId: p.orderLineId,
    reason: p.reason,
  });

  return owned(t, 'inventory_balances', bal.id, a);
}

export async function releaseInventory(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'prepare');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = inventoryRelease.parse(payload);
  const prod = await owned(t, 'products', p.productId, a);
  const loc = await owned(t, 'locations', p.locationId, a);
  const owner = await resolveOwner(t, a.org_id, p.ownerId);
  const ownerId = owner.id;
  const relQty = new Decimal(p.quantity);

  const balRes = await t.query(
    'SELECT * FROM inventory_balances WHERE org_id=$1 AND warehouse_id=$2 AND product_id=$3 AND location_id=$4 AND owner_id=$5 AND unit=$6 FOR UPDATE',
    [a.org_id, a.warehouse_id, prod.id, loc.id, ownerId, p.unit],
  );
  const bal = balRes.rows[0];
  requireRule(bal, 'NOT_FOUND', 'No stock balance found to release', 404);

  const curReserved = new Decimal(bal.reserved);
  requireRule(
    curReserved.gte(relQty),
    'INVALID_RELEASE',
    'Cannot release more than currently reserved stock',
    409,
  );

  const nextReserved = curReserved.minus(relQty);
  const nextAvailable = new Decimal(bal.available).plus(relQty);

  await t.query(
    'UPDATE inventory_balances SET available=$1, reserved=$2, version=version+1, updated_at=now() WHERE id=$3',
    [nextAvailable.toFixed(6), nextReserved.toFixed(6), bal.id],
  );

  await t.query(
    `INSERT INTO inventory_ledger(id, org_id, warehouse_id, product_id, location_id, owner_id, quantity_delta, unit, state, reference_type, reference_id, notes, actor_id)
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, 'available', 'release', $9, $10, $11)`,
    [
      uuid(),
      a.org_id,
      a.warehouse_id,
      prod.id,
      loc.id,
      ownerId,
      relQty.toFixed(6),
      p.unit,
      p.orderLineId || bal.id,
      p.reason,
      a.id,
    ],
  );

  await event(t, a, bal.id, 'inventory.released', {
    balanceId: bal.id,
    quantity: relQty.toFixed(6),
    orderLineId: p.orderLineId,
    reason: p.reason,
  });

  return owned(t, 'inventory_balances', bal.id, a);
}
