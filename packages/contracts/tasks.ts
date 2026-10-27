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
  })
  .strict();

export const taskAssign = versioned
  .extend({
    userId: id,
  })
  .strict();

export const taskComplete = versioned
  .extend({
    scanConfirmation: z.string().trim().min(1).max(120),
    reason: z.string().max(500).optional(),
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
