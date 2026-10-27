import { randomUUID as uuid } from 'node:crypto';
import type { DB } from '../database/index.js';
import {
  onboardingStepSave,
  onboardingReviewComplete,
  onboardingSteps,
} from '../contracts/onboarding.js';
import { authorize, owned, version, event, type Actor } from './services.js';
import { requireRule, DomainError } from './index.js';

export async function getWarehouseOnboarding(t: DB, a: Actor) {
  authorize(a, 'configure');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);

  let ob = (
    await t.query(
      'SELECT * FROM warehouse_onboarding WHERE org_id=$1 AND warehouse_id=$2',
      [a.org_id, a.warehouse_id],
    )
  ).rows[0];

  if (!ob) {
    const id = uuid();
    await t.query(
      `INSERT INTO warehouse_onboarding(id, org_id, warehouse_id, step, completed_steps, step_data, status, policy_version, version)
       VALUES($1, $2, $3, 'profile', '[]', '{}', 'in_progress', 1, 1)`,
      [id, a.org_id, a.warehouse_id],
    );
    ob = (
      await t.query('SELECT * FROM warehouse_onboarding WHERE id=$1', [id])
    ).rows[0];
  }

  // Calculate live readiness summary
  const staffCount = (
    await t.query(
      'SELECT count(*)::int n FROM warehouse_grants WHERE org_id=$1 AND warehouse_id=$2 AND active=true',
      [a.org_id, a.warehouse_id],
    )
  ).rows[0].n;

  const locCount = (
    await t.query(
      'SELECT count(*)::int n FROM locations WHERE org_id=$1 AND warehouse_id=$2',
      [a.org_id, a.warehouse_id],
    )
  ).rows[0].n;

  const prodCount = (
    await t.query('SELECT count(*)::int n FROM products WHERE org_id=$1', [
      a.org_id,
    ])
  ).rows[0].n;

  const suppCount = (
    await t.query('SELECT count(*)::int n FROM suppliers WHERE org_id=$1', [
      a.org_id,
    ])
  ).rows[0].n;

  const custCount = (
    await t.query('SELECT count(*)::int n FROM customers WHERE org_id=$1', [
      a.org_id,
    ])
  ).rows[0].n;

  const stockBalCount = (
    await t.query(
      'SELECT count(*)::int n FROM inventory_balances WHERE org_id=$1 AND warehouse_id=$2',
      [a.org_id, a.warehouse_id],
    )
  ).rows[0].n;

  const latestPolicySnapshot = (
    await t.query(
      'SELECT * FROM policy_snapshots WHERE org_id=$1 AND warehouse_id=$2 ORDER BY created_at DESC LIMIT 1',
      [a.org_id, a.warehouse_id],
    )
  ).rows[0];

  return {
    ...ob,
    steps: onboardingSteps,
    readiness: {
      staffCount,
      locationsCount: locCount,
      productsCount: prodCount,
      suppliersCount: suppCount,
      customersCount: custCount,
      stockBalancesCount: stockBalCount,
      hasPolicySnapshot: !!latestPolicySnapshot,
      latestSnapshotDate: latestPolicySnapshot?.created_at || null,
    },
  };
}

export async function saveOnboardingStep(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'configure');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = onboardingStepSave.parse(payload);

  const ob = await getWarehouseOnboarding(t, a);
  const completed = new Set<string>(ob.completed_steps || []);
  if (p.markCompleted) {
    completed.add(p.step);
  }

  const stepData = { ...(ob.step_data || {}), [p.step]: p.stepData };

  // Calculate next step
  const currentIndex = onboardingSteps.indexOf(p.step);
  const nextStep =
    p.markCompleted && currentIndex < onboardingSteps.length - 1
      ? onboardingSteps[currentIndex + 1]
      : p.step;

  await t.query(
    `UPDATE warehouse_onboarding
     SET step=$1, completed_steps=$2, step_data=$3, version=version+1, updated_at=now()
     WHERE id=$4`,
    [nextStep, JSON.stringify([...completed]), JSON.stringify(stepData), ob.id],
  );

  await event(t, a, ob.id, 'onboarding.step_saved', {
    step: p.step,
    markCompleted: p.markCompleted,
    nextStep,
    reason: p.reason,
  });

  return getWarehouseOnboarding(t, a);
}

export async function completeOnboardingReview(
  t: DB,
  a: Actor,
  payload: unknown,
) {
  authorize(a, 'configure');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = onboardingReviewComplete.parse(payload);

  const ob = await getWarehouseOnboarding(t, a);

  // Take policy snapshot preserving policy version at this consequential transaction
  const snapshotId = uuid();
  const policyData = {
    onboardingData: ob.step_data,
    completedSteps: ob.completed_steps,
    readiness: ob.readiness,
    reviewedBy: a.id,
    reviewedAt: new Date().toISOString(),
    notes: p.policyNotes,
  };

  await t.query(
    `INSERT INTO policy_snapshots(id, org_id, warehouse_id, entity_type, entity_id, policy_version, policy_data)
     VALUES($1, $2, $3, 'warehouse_onboarding', $4, $5, $6)`,
    [
      snapshotId,
      a.org_id,
      a.warehouse_id,
      ob.id,
      p.policyVersion,
      JSON.stringify(policyData),
    ],
  );

  const allSteps = [...onboardingSteps];
  await t.query(
    `UPDATE warehouse_onboarding
     SET status='completed', completed_steps=$1, policy_version=$2, version=version+1, updated_at=now()
     WHERE id=$3`,
    [JSON.stringify(allSteps), p.policyVersion, ob.id],
  );

  await event(t, a, ob.id, 'onboarding.completed', {
    policyVersion: p.policyVersion,
    snapshotId,
    notes: p.policyNotes,
    reason: p.reason,
  });

  return {
    ...(await getWarehouseOnboarding(t, a)),
    policySnapshotId: snapshotId,
  };
}
