export { nextPreparationDate } from './date.js';
import type { DB } from '../database/index.js';
import { authorize, type Actor, services } from './services.js';
import { requireRule } from './index.js';

export async function suggestPreparationBatches(
  t: DB,
  a: Actor,
  fromDate: string,
  count = 4,
) {
  authorize(a, 'prepare');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);

  const config = (
    await t.query('SELECT preparation_weekdays FROM company_configuration WHERE org_id=$1', [
      a.org_id,
    ])
  ).rows[0];
  const weekdays: number[] = config?.preparation_weekdays || [];
  if (!weekdays.length) return [];

  const suggestions: Array<{ businessDate: string; weekday: number; emptyBatch: true; orderIds: string[] }> = [];
  let cur = new Date(fromDate + 'T12:00:00Z');

  while (suggestions.length < count) {
    if (weekdays.includes(cur.getUTCDay())) {
      suggestions.push({
        businessDate: cur.toISOString().slice(0, 10),
        weekday: cur.getUTCDay(),
        emptyBatch: true,
        orderIds: [],
      });
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  return suggestions;
}

export async function createScheduledEmptyBatch(
  t: DB,
  a: Actor,
  payload: { businessDate: string; reason?: string },
) {
  authorize(a, 'prepare');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);

  const config = (
    await t.query('SELECT preparation_weekdays FROM company_configuration WHERE org_id=$1', [
      a.org_id,
    ])
  ).rows[0];
  const weekdays: number[] = config?.preparation_weekdays || [];
  const date = new Date(payload.businessDate + 'T12:00:00Z');
  requireRule(Number.isFinite(date.getTime()), 'INVALID_DATE', 'Provide a valid business date');

  requireRule(
    weekdays.includes(date.getUTCDay()),
    'DATE_NOT_SCHEDULED',
    `Date ${payload.businessDate} is not a configured preparation weekday for this company`,
    422,
  );

  // Invariant: Recurring templates create/suggest empty batches only.
  // Wednesday remains JadeSun preparation, never implicit delivery or automatic customer orders.
  return services.preparation(t, a, {
    businessDate: payload.businessDate,
    orderIds: [],
  });
}
