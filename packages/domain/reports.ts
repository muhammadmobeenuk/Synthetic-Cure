import type { DB } from '../database/index.js';
import type { Actor } from './index.js';
import { requireRule } from './index.js';
import type { OperationsReportData, OperationsReportQuery } from '../contracts/reports.js';
import { generateOperationsPptx } from './pptx-generator.js';

export async function getOperationsReportData(
  db: DB,
  actor: Actor,
  query: OperationsReportQuery = {}
): Promise<OperationsReportData> {
  requireRule(
    actor.role === 'administrator' || actor.role === 'supervisor' || actor.role === 'reviewer',
    'FORBIDDEN',
    'Operations reporting requires supervisor, administrator, or reviewer privileges',
    403
  );

  requireRule(!!actor.warehouse_id, 'WAREHOUSE_REQUIRED', 'Active warehouse context required for operational reporting', 400);

  const orgRes = await db.query('SELECT id, name FROM organizations WHERE id = $1', [actor.org_id]);
  const org = orgRes.rows[0] || { id: actor.org_id, name: 'Organization' };

  const whRes = await db.query('SELECT id, code, name FROM warehouses WHERE id = $1 AND org_id = $2', [actor.warehouse_id, actor.org_id]);
  const wh = whRes.rows[0] || { id: actor.warehouse_id, code: 'WH', name: 'Warehouse' };


  // 1. Inbound metrics
  const poRes = await db.query(
    `SELECT COUNT(DISTINCT po.id) AS po_count,
            COALESCE(SUM(pol.expected_quantity), 0) AS total_expected
     FROM purchase_orders po
     LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
     WHERE po.org_id = $1 AND po.warehouse_id = $2`,
    [actor.org_id, actor.warehouse_id]
  );
  const poCount = Number(poRes.rows[0]?.po_count || 0);
  const totalExpected = String(poRes.rows[0]?.total_expected || '0');

  const boxRes = await db.query(
    `SELECT COUNT(*) AS box_count
     FROM expected_receipt_boxes erb
     JOIN expected_receipts er ON er.id = erb.expected_receipt_id
     WHERE er.org_id = $1 AND er.warehouse_id = $2`,
    [actor.org_id, actor.warehouse_id]
  );
  const receivedBoxesCount = Number(boxRes.rows[0]?.box_count || 0);

  const discRes = await db.query(
    `SELECT kind, COUNT(*) AS count
     FROM inbound_discrepancies
     WHERE org_id = $1 AND warehouse_id = $2
     GROUP BY kind`,
    [actor.org_id, actor.warehouse_id]
  );
  const discrepancyBreakdown = { damaged: 0, short: 0, over: 0, unexpected: 0 };
  let discrepanciesCount = 0;
  for (const r of discRes.rows) {
    const c = Number(r.count || 0);
    discrepanciesCount += c;
    if (r.kind in discrepancyBreakdown) {
      discrepancyBreakdown[r.kind as keyof typeof discrepancyBreakdown] = c;
    }
  }

  // 2. Picking metrics
  const pickRes = await db.query(
    `SELECT COUNT(*) AS pick_count,
            COALESCE(SUM(quantity_picked), 0) AS total_units,
            COUNT(*) FILTER (WHERE shortage_quantity IS NOT NULL AND shortage_quantity > 0) AS shortage_count,
            COUNT(*) FILTER (WHERE is_substitution = true) AS sub_count
     FROM picking_verifications
     WHERE org_id = $1 AND warehouse_id = $2`,
    [actor.org_id, actor.warehouse_id]
  );
  const totalPicksVerified = Number(pickRes.rows[0]?.pick_count || 0);
  const totalUnitsPicked = String(pickRes.rows[0]?.total_units || '0');
  const shortagePicksCount = Number(pickRes.rows[0]?.shortage_count || 0);
  const substitutionsCount = Number(pickRes.rows[0]?.sub_count || 0);

  const toteRes = await db.query(
    `SELECT COUNT(*) AS count
     FROM picking_totes
     WHERE org_id = $1 AND warehouse_id = $2 AND status = 'in_use'`,
    [actor.org_id, actor.warehouse_id]
  );
  const totesDispatchedCount = Number(toteRes.rows[0]?.count || 0);

  // 3. Inventory metrics
  const invRes = await db.query(
    `SELECT COALESCE(SUM(on_hand), 0) AS on_hand,
            COALESCE(SUM(reserved), 0) AS reserved,
            COALESCE(SUM(available), 0) AS available,
            COALESCE(SUM(held), 0) AS held
     FROM inventory_balances
     WHERE org_id = $1 AND warehouse_id = $2`,
    [actor.org_id, actor.warehouse_id]
  );
  const totalOnHandQuantity = String(invRes.rows[0]?.on_hand || '0');
  const totalReservedQuantity = String(invRes.rows[0]?.reserved || '0');
  const totalAvailableQuantity = String(invRes.rows[0]?.available || '0');
  const totalHeldQuantity = String(invRes.rows[0]?.held || '0');

  const soRes = await db.query(
    `SELECT so.id, so.name,
            COALESCE(SUM(ib.on_hand), 0) AS on_hand,
            COALESCE(SUM(ib.available), 0) AS available,
            COALESCE(SUM(ib.held), 0) AS held
     FROM stock_owners so
     LEFT JOIN inventory_balances ib ON ib.owner_id = so.id AND ib.org_id = $1 AND ib.warehouse_id = $2
     WHERE so.org_id = $1
     GROUP BY so.id, so.name
     ORDER BY on_hand DESC
     LIMIT 10`,
    [actor.org_id, actor.warehouse_id]
  );
  const stockOwners = soRes.rows.map(r => ({
    ownerId: String(r.id),
    ownerName: String(r.name),
    onHand: String(r.on_hand || '0'),
    available: String(r.available || '0'),
    held: String(r.held || '0')
  }));

  // 4. Quality holds
  const qhRes = await db.query(
    `SELECT severity, scope, COUNT(*) AS count
     FROM quality_holds
     WHERE org_id = $1 AND warehouse_id = $2 AND status = 'active'
     GROUP BY severity, scope`,
    [actor.org_id, actor.warehouse_id]
  );
  let activeHoldsCount = 0;
  const holdSeverityBreakdown = { critical: 0, major: 0, minor: 0 };
  let quarantinedLotsCount = 0;
  let quarantinedSerialsCount = 0;
  for (const r of qhRes.rows) {
    const c = Number(r.count || 0);
    activeHoldsCount += c;
    if (r.severity in holdSeverityBreakdown) {
      holdSeverityBreakdown[r.severity as keyof typeof holdSeverityBreakdown] += c;
    }
    if (r.scope === 'lot') quarantinedLotsCount += c;
    if (r.scope === 'serial') quarantinedSerialsCount += c;
  }

  // 5. Tasks backlog
  const taskRes = await db.query(
    `SELECT status, priority, COUNT(*) AS count
     FROM warehouse_tasks
     WHERE org_id = $1 AND warehouse_id = $2
     GROUP BY status, priority`,
    [actor.org_id, actor.warehouse_id]
  );
  let openTasksCount = 0;
  let claimedTasksCount = 0;
  let blockedTasksCount = 0;
  let urgentPriorityCount = 0;
  for (const r of taskRes.rows) {
    const c = Number(r.count || 0);
    if (r.status === 'open') openTasksCount += c;
    if (r.status === 'claimed' || r.status === 'in_progress') claimedTasksCount += c;
    if (r.status === 'blocked') blockedTasksCount += c;
    if (r.priority === 'urgent' && r.status !== 'completed' && r.status !== 'cancelled') urgentPriorityCount += c;
  }

  return {
    generatedAt: new Date().toISOString(),
    company: {
      id: String(org.id),
      code: String(org.code || 'ORG'),
      name: String(org.name || 'Organization')
    },
    warehouse: {
      id: String(wh.id),
      code: String(wh.code || 'WH'),
      name: String(wh.name || 'Warehouse')
    },
    dateRange: {
      startDate: query.startDate || null,
      endDate: query.endDate || null
    },
    inbound: {
      purchaseOrdersCount: poCount,
      totalExpectedUnits: totalExpected,
      receivedBoxesCount,
      discrepanciesCount,
      discrepancyBreakdown
    },
    picking: {
      totalPicksVerified,
      totalUnitsPicked,
      shortagePicksCount,
      substitutionsCount,
      totesDispatchedCount
    },
    inventory: {
      totalOnHandQuantity,
      totalReservedQuantity,
      totalAvailableQuantity,
      totalHeldQuantity,
      stockOwners
    },
    quality: {
      activeHoldsCount,
      holdSeverityBreakdown,
      quarantinedLotsCount,
      quarantinedSerialsCount
    },
    tasks: {
      openTasksCount,
      claimedTasksCount,
      blockedTasksCount,
      urgentPriorityCount
    }
  };
}

export async function exportOperationsPptx(
  db: DB,
  actor: Actor,
  query: OperationsReportQuery = {}
): Promise<Buffer> {
  const data = await getOperationsReportData(db, actor, query);
  return generateOperationsPptx(data);
}
