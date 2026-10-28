import { z } from "zod";

export const offlineOperationQueue = z.object({
  operationId: z.string().uuid(),
  command: z.string().min(1).max(120),
  endpoint: z.string().min(1),
  payload: z.record(z.string(), z.any()),
  expectedVersion: z.number().int().positive().optional(),
  dependsOnOperationId: z.string().uuid().optional(),
  fileUploadId: z.string().optional(),
});

export const offlineConflictResolve = z.object({
  resolution: z.enum(["rebase_and_retry", "discard"]),
  newExpectedVersion: z.number().int().positive().optional(),
  modifiedPayload: z.record(z.string(), z.any()).optional(),
  clientOperationId: z.string().uuid(),
});

export const offlineBatchSync = z.object({
  operations: z.array(offlineOperationQueue),
  clientOperationId: z.string().uuid(),
});

export type OfflineOperationQueue = z.infer<typeof offlineOperationQueue>;
export type OfflineConflictResolve = z.infer<typeof offlineConflictResolve>;
export type OfflineBatchSync = z.infer<typeof offlineBatchSync>;
