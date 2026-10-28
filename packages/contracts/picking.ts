import { z } from 'zod';
import { command, id, quantity } from './primitives.js';

export const toteRegister = command
  .extend({
    code: z.string().trim().min(1).max(80),
  })
  .strict();

export const pickVerify = command
  .extend({
    orderId: id,
    orderLineId: id,
    allocationId: id.optional(),
    toteId: id.optional(),
    toteCode: z.string().trim().min(1).max(80).optional(),
    sourceLocationId: id,
    productId: id.optional(),
    scannedProductId: id.optional(),
    lotId: id.optional(),
    quantityPicked: quantity,
    quantityRequested: quantity.optional(),
    isSubstitution: z.boolean().default(false),
    substitutedProductId: id.optional(),
    substitutionReason: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();
