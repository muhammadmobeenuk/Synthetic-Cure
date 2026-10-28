import { z } from "zod";
import { id, quantity, command, versioned } from "./primitives.js";

export const portalDraftOrder = command.extend({
  destinationId: id,
  lines: z
    .array(
      z.object({
        productId: id,
        quantity,
        unit: z.string().min(1).max(30),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (lines) => new Set(lines.map((l) => l.productId)).size === lines.length,
      "Each product may appear only once per order",
    ),
  customerReference: z.string().max(100).optional(),
  note: z.string().max(1000).optional(),
});

export const portalLinkUser = command.extend({
  userId: id,
  customerId: id.nullable().optional(),
  stockOwnerId: id.nullable().optional(),
  reason: z.string().min(3).max(500),
}).refine(
  (data) => data.customerId !== null || data.stockOwnerId !== null,
  "Must link user to at least a customer or a stock owner",
);
