import { z } from "zod";
import { id, command, versioned } from "./primitives.js";

export const carrierManifestBooking = command.extend({
  tripId: id,
  carrierCode: z.string().trim().min(1).max(50),
  carrierName: z.string().trim().min(1).max(100),
  serviceLevel: z.string().trim().max(50).optional(),
  trackingReference: z.string().trim().max(100).optional(),
  vehicleTypeRequired: z.string().trim().max(100).optional(),
  specialInstructions: z.string().trim().max(1000).optional(),
});

export const carrierManifestStatusUpdate = versioned.extend({
  status: z.enum(["booked", "manifested", "collected", "in_transit", "completed", "cancelled"]),
  trackingReference: z.string().trim().max(100).optional(),
  reason: z.string().trim().min(3).max(500),
});

export const accountingExportParams = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  customerId: id.optional(),
  status: z.enum(["all", "delivered", "fulfilled"]).default("delivered"),
  includeUnconfirmedPricing: z.coerce.boolean().default(false),
});
