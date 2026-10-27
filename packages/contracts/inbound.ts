import { z } from 'zod';
import { command, versioned, id, quantity } from './primitives.js';

export const supplierCreate = command
  .extend({
    code: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(200),
  })
  .strict();

export const expectedCreate = command
  .extend({
    supplierId: id,
    productId: id,
    reference: z.string().trim().min(1).max(200),
    expectedDate: z.iso.date(),
    quantity,
    unit: z.string().min(1).max(30),
  })
  .strict();

export const expectedReceive = versioned
  .extend({
    locationId: id,
    quantity,
    condition: z.enum(['good', 'damaged', 'hold']),
    sourceLabel: z.string().max(2000).default(''),
  })
  .strict();

export const expectedCancel = versioned
  .extend({
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

export const purchaseOrderCreate = command
  .extend({
    supplierId: id,
    poNumber: z.string().trim().min(1).max(120),
    supplierReference: z.string().trim().min(1).max(200),
    expectedDate: z.iso.date(),
    lines: z
      .array(
        z.object({
          productId: id,
          expectedQuantity: quantity,
          unit: z.string().min(1).max(30),
        }),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const purchaseOrderReceive = versioned
  .extend({
    lineId: id,
    locationId: id,
    quantity,
    unit: z.string().min(1).max(30),
    condition: z.enum(['good', 'damaged', 'hold']).default('good'),
    sourceLabel: z.string().max(2000).default(''),
  })
  .strict();

export const purchaseOrderCancel = versioned
  .extend({
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

export const discrepancyReport = command
  .extend({
    purchaseOrderId: id.optional(),
    poLineId: id.optional(),
    expectedReceiptId: id.optional(),
    productId: id,
    kind: z.enum(['unexpected', 'over', 'short', 'damaged']),
    reportedQuantity: quantity,
    unit: z.string().min(1).max(30),
    evidence: z.string().trim().min(3).max(2000),
  })
  .strict();

export const discrepancyReview = versioned
  .extend({
    approved: z.boolean(),
    disposition: z.enum(['accept_hold', 'reject_return', 'adjust_po']),
    notes: z.string().trim().min(3).max(1000),
  })
  .strict();

export const supplierReturnCreate = command
  .extend({
    supplierId: id,
    discrepancyId: id.optional(),
    productId: id,
    boxId: id.optional(),
    quantity,
    unit: z.string().min(1).max(30),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

export const supplierReturnAuthorize = versioned
  .extend({
    notes: z.string().trim().min(3).max(1000),
  })
  .strict();

export const supplierReturnDispatch = versioned
  .extend({
    outboundTracking: z.string().trim().min(1).max(200),
    notes: z.string().trim().min(3).max(1000),
  })
  .strict();
