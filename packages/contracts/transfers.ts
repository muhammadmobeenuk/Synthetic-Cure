import { z } from 'zod';
import { command, versioned, id, quantity } from './primitives.js';

export const transferOrderCreate = command
  .extend({
    orderNumber: z.string().trim().min(1).max(120),
    destinationWarehouseId: id,
    lines: z
      .array(
        z.object({
          productId: id,
          boxId: id.optional(),
          requestedQuantity: quantity,
          unit: z.string().min(1).max(30),
        }),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const transferOrderDispatch = versioned
  .extend({
    lineDispatches: z
      .array(
        z.object({
          lineId: id,
          dispatchedQuantity: quantity,
          sourceLocationId: id,
        }),
      )
      .min(1),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

export const transferOrderReceive = versioned
  .extend({
    lineReceipts: z
      .array(
        z.object({
          lineId: id,
          receivedQuantity: quantity,
          damagedQuantity: quantity.or(z.literal('0')).default('0'),
          locationId: id,
        }),
      )
      .min(1),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

export const transferOrderCancel = versioned
  .extend({
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();
