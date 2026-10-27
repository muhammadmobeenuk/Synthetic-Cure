import { z } from 'zod';

export const id = z.string().min(1).max(120);

export const quantity = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/)
  .refine((v) => Number(v) > 0, 'Quantity must be greater than zero');

export const command = z.object({ clientOperationId: z.uuid() });

export const versioned = command.extend({
  expectedVersion: z.number().int().positive(),
});
