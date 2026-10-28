import { z } from 'zod';
import { command, versioned, id, quantity } from './primitives.js';

export const driverReassign = versioned
  .extend({
    newDriverId: id,
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

export const deliveryFail = versioned
  .extend({
    reason: z.string().trim().min(3).max(1000),
    note: z.string().max(2000).optional(),
  })
  .strict();

export const stopCollectReturn = command
  .extend({
    stopId: id,
    customerId: id,
    productId: id,
    quantity,
    unit: z.string().min(1).max(30),
    reason: z.string().trim().min(3).max(1000),
    sourceBoxCode: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
