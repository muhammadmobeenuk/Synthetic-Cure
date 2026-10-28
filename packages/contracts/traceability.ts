import { z } from "zod";

export const qualityHoldCreate = z.object({
  scope: z.enum(["product", "lot", "serial", "box", "location"]),
  targetId: z.string().min(1).max(120),
  reason: z.string().min(3).max(2000),
  severity: z.enum(["critical", "major", "minor"]).default("major"),
  clientOperationId: z.string().uuid(),
});

export const qualityHoldRelease = z.object({
  expectedVersion: z.number().int().positive(),
  releaseReason: z.string().min(3).max(2000),
  disposition: z.enum(["scrap", "return_to_supplier", "rework", "release_as_is"]).optional(),
  clientOperationId: z.string().uuid(),
});

export const recallInitiate = z.object({
  code: z.string().min(1).max(80),
  title: z.string().min(3).max(200),
  productId: z.string().min(1).max(120),
  lotId: z.string().min(1).max(120).optional(),
  reason: z.string().min(3).max(4000),
  severity: z.enum(["class_1", "class_2", "class_3"]),
  clientOperationId: z.string().uuid(),
});

export const recallClose = z.object({
  expectedVersion: z.number().int().positive(),
  closureNotes: z.string().min(3).max(4000),
  clientOperationId: z.string().uuid(),
});

export const serialRegister = z.object({
  productId: z.string().min(1).max(120),
  lotId: z.string().min(1).max(120).optional(),
  serialNumber: z.string().min(1).max(120),
  boxId: z.string().min(1).max(120).optional(),
  locationId: z.string().min(1).max(120).optional(),
  clientOperationId: z.string().uuid(),
});

export type QualityHoldCreate = z.infer<typeof qualityHoldCreate>;
export type QualityHoldRelease = z.infer<typeof qualityHoldRelease>;
export type RecallInitiate = z.infer<typeof recallInitiate>;
export type RecallClose = z.infer<typeof recallClose>;
export type SerialRegister = z.infer<typeof serialRegister>;
