import { z } from 'zod';
import { command, versioned, id, quantity } from './primitives.js';

export const putawayTaskCreate = command
  .extend({
    boxId: id.optional(),
    productId: id.optional(),
    sourceLocationId: id,
    destinationLocationId: id,
    quantity: quantity.optional(),
    unit: z.string().min(1).max(30).optional(),
    priority: z.number().int().min(1).max(10).default(1),
    dueAt: z.string().datetime().optional(),
  })
  .strict();

export const taskAssign = versioned
  .extend({
    userId: id,
    reason: z.string().max(500).optional(),
  })
  .strict();

export const taskClaim = versioned.strict();

export const taskReassign = versioned
  .extend({
    userId: id,
    reason: z.string().max(500).optional(),
  })
  .strict();

export const taskStart = versioned.strict();

export const taskBlock = versioned
  .extend({
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

export const taskComplete = versioned
  .extend({
    scanConfirmation: z.string().trim().min(1).max(120),
    executionReferenceId: z.string().optional(),
    reason: z.string().max(500).optional(),
  })
  .strict();

export const shiftHandoverCreate = command
  .extend({
    shiftName: z.string().trim().min(1).max(100),
    handoverDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    incomingUserId: id.optional(),
    notes: z.string().trim().min(3).max(4000),
    pendingTasks: z.array(id).optional(),
    blockedTasks: z.array(id).optional(),
  })
  .strict();

export const shiftHandoverAcknowledge = versioned
  .extend({
    notes: z.string().max(1000).optional(),
  })
  .strict();

export const taskCancel = versioned
  .extend({
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

export const replenishmentPolicySet = command
  .extend({
    locationId: id,
    productId: id,
    minQuantity: quantity,
    targetQuantity: quantity,
    unit: z.string().min(1).max(30),
  })
  .strict()
  .refine(
    (p) => Number(p.targetQuantity) > Number(p.minQuantity),
    'Target quantity must be greater than minimum quantity',
  );

export const replenishmentTrigger = command
  .extend({
    locationId: id.optional(),
    productId: id.optional(),
  })
  .strict();
