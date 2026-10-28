import { z } from 'zod';
import { versioned } from './primitives.js';

export const orderCancelReconcile = versioned
  .extend({
    reason: z.string().trim().min(3).max(1000),
    createBackorders: z.boolean().default(false),
    createBackorder: z.boolean().optional(),
  })
  .strict();
