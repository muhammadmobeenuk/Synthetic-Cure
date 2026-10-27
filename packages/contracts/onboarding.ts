import { z } from 'zod';
import { command, id } from './primitives.js';

export const onboardingSteps = [
  'profile',
  'staff',
  'schedule',
  'labels',
  'imports',
  'opening_balances',
  'review',
] as const;

export const onboardingStepSave = command
  .extend({
    step: z.enum(onboardingSteps),
    stepData: z.record(z.string(), z.any()),
    markCompleted: z.boolean().default(false),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

export const onboardingReviewComplete = command
  .extend({
    warehouseId: id.optional(),
    policyVersion: z.number().int().positive().default(1),
    policyNotes: z.string().trim().min(3).max(2000),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
