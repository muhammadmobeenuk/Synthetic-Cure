import { z } from 'zod';
import { command, versioned, id, quantity } from './primitives.js';

export const ownerCreate = command.extend({
  code: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
}).strict();

export const unitConversionCreate = command.extend({
  fromUnit: z.string().trim().min(1).max(30),
  toUnit: z.string().trim().min(1).max(30),
  factor: quantity,
  verified: z.boolean().default(false),
}).strict();

export const inventoryAdjust = command.extend({
  productId: id,
  locationId: id,
  ownerId: id.optional(),
  quantityDelta: z
    .string()
    .regex(/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/)
    .refine((v) => Number(v) !== 0, 'Quantity delta cannot be zero'),
  unit: z.string().trim().min(1).max(30),
  state: z.enum(['on_hand', 'reserved', 'available', 'picked', 'in_transit', 'held', 'dispatched']).default('on_hand'),
  reason: z.string().trim().min(3).max(1000),
}).strict();

export const inventoryMove = versioned.extend({
  productId: id,
  sourceLocationId: id,
  destinationLocationId: id,
  ownerId: id.optional(),
  quantity,
  unit: z.string().trim().min(1).max(30),
  reason: z.string().trim().min(3).max(1000),
}).strict();

export const inventoryReserve = command.extend({
  productId: id,
  locationId: id,
  ownerId: id.optional(),
  orderLineId: id.optional(),
  quantity,
  unit: z.string().trim().min(1).max(30),
  reason: z.string().trim().min(3).max(1000),
}).strict();

export const inventoryRelease = command.extend({
  productId: id,
  locationId: id,
  ownerId: id.optional(),
  orderLineId: id.optional(),
  quantity,
  unit: z.string().trim().min(1).max(30),
  reason: z.string().trim().min(3).max(1000),
}).strict();
