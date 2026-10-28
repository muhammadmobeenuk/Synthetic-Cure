import { z } from "zod";
export * from "./primitives.js";
import { id, quantity, command, versioned } from "./primitives.js";
export const contentsLine = z
  .object({
    productId: id,
    quantity: quantity.nullable(),
    unit: z.string().min(1).max(30),
    verified: z.boolean(),
    lotId: id.optional(),
    catchWeight: quantity.nullable().optional(),
    packageCount: z.number().int().positive().nullable().optional(),
    temperatureC: z
      .string()
      .regex(/^-?\d{1,5}(?:\.\d{1,3})?$/)
      .nullable()
      .optional(),
  })
  .refine(
    (x) => !x.verified || x.quantity !== null,
    "Verified quantity cannot be unknown",
  );
export const receipt = command.extend({
  customerId: id.nullable(),
  locationId: id,
  sourceLabel: z.string().max(2000).default(""),
  condition: z.enum(["good", "damaged", "hold"]).default("good"),
  contents: z.array(contentsLine).max(30),
});
export const confirm = versioned.extend({
  reason: z.string().min(3).max(1000).optional(),
  contents: z.array(contentsLine).min(1).max(30),
});
export const movement = versioned.extend({
  locationId: id,
  reason: z.string().min(3).max(500),
});
export const membership = versioned.extend({
  boxIds: z.array(id).min(1).max(100),
  locationId: id.optional(),
});
export const palletCreate = command.extend({ locationId: id });
export const orderCreate = command.extend({
  customerId: id,
  destinationId: id,
  lines: z
    .array(
      z.object({ productId: id, quantity, unit: z.string().min(1).max(30) }),
    )
    .min(1).max(100).refine(lines => new Set(lines.map(l=>l.productId)).size === lines.length, "Each product may appear only once per order"),
});
export const allocate = versioned.extend({
  boxId: id,
  orderLineId: id,
  quantity,
});
export const prepare = command.extend({
  businessDate: z.iso.date(),
  orderIds: z.array(id).max(100),
});
export const advance = versioned.extend({
  stage: z.enum(["selected", "picking", "packing", "checking", "ready"]),
  stagingLocationId: id.optional(),
  partialApproved: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});
export const tripCreate = command.extend({
  businessDate: z.iso.date(),
  driverId: id.nullable(),
  vehicle: z.string().max(100).nullable(),
  shipmentIds: z.array(id).min(1),
});
export const handover = versioned.extend({
  lines: z
    .array(
      z.object({
        lineId: id,
        delivered: quantity.or(z.literal("0")),
        returned: quantity.or(z.literal("0")),
      }),
    )
    .min(1),
  note: z.string().min(3).max(1000),
});
export const reportIssue = command.extend({
  boxId: id.nullable(),
  kind: z.enum([
    "unclear label",
    "shortage",
    "damage",
    "document mismatch",
    "count discrepancy",
    "other",
  ]),
  note: z.string().min(3).max(2000),
});

export const loosePick = versioned.extend({
  sourceBoxId: id,
  sourceVersion: z.number().int().positive(),
  contentsId: id,
  orderLineId: id,
  quantity,
  targetBoxId: id.optional(),
  targetVersion: z.number().int().positive().optional(),
  locationId: id,
  temperatureC: z
    .string()
    .regex(/^-?\d{1,5}(?:\.\d{1,3})?$/)
    .nullable()
    .optional(),
  reason: z.string().min(3).max(1000),
});
const temperature = z
  .string()
  .regex(/^-?\d{1,5}(?:\.\d{1,3})?$/)
  .nullable();
export const traceability = versioned
  .extend({
    requireLot: z.boolean(),
    requireExpiry: z.boolean(),
    requireTemperature: z.boolean(),
    temperatureMin: temperature,
    temperatureMax: temperature,
    reason: z.string().min(3).max(1000),
  })
  .refine(
    (p) =>
      p.temperatureMin === null ||
      p.temperatureMax === null ||
      Number(p.temperatureMin) <= Number(p.temperatureMax),
    "Minimum temperature exceeds maximum",
  );

export const companyConfiguration = versioned.extend({
  section: z.enum(['identity','locale','schedule']),
  displayName: z.string().trim().min(1).max(200).optional(),
  operatingProfile: z.enum(['general','wholesale','food','printed','3pl']).nullable().optional(),
  timezone: z.string().min(1).max(100).refine(v=>{try { new Intl.DateTimeFormat('en',{timeZone:v}); return true; } catch {return false;}}, 'Use a valid IANA timezone').optional(),
  language: z.enum(['en','zh']).optional(),
  dateFormat: z.enum(['day-first','iso']).optional(),
  preparationWeekdays: z.array(z.number().int().min(0).max(6)).max(7).refine(v=>new Set(v).size===v.length,'Choose each day once').optional(),
  reason: z.string().trim().min(3).max(1000),
}).superRefine((p,ctx)=>{
  const required = p.section==='identity' ? ['displayName','operatingProfile'] : p.section==='locale' ? ['timezone','language','dateFormat'] : ['preparationWeekdays'];
  for(const key of required) if(p[key as keyof typeof p]===undefined) ctx.addIssue({code:'custom',path:[key],message:'Required for this setup step'});
  const allowed=new Set(['clientOperationId','expectedVersion','section','reason',...required]);
  for(const key of Object.keys(p)) if(!allowed.has(key)) ctx.addIssue({code:'custom',path:[key],message:'Update only the selected setup section'});
});

export const role = z.enum(['administrator','supervisor','operator','dispatcher','driver','reviewer']);
export const staffProvision = command.extend({
  email: z.string().email(),
  name: z.string().trim().min(1).max(120),
  role,
  password: z.string().min(8).max(120).optional(),
  warehouseId: id.optional(),
  reason: z.string().trim().min(3).max(1000),
});
export const membershipChange = command.extend({email:z.email(),expectedVersion:z.number().int().min(0),role,active:z.boolean(),reason:z.string().trim().min(3).max(1000)});
export const warehouseCreate = command.extend({code:z.string().trim().min(1).max(80),name:z.string().trim().min(1).max(200),address:z.string().trim().max(1000).nullable(),reason:z.string().trim().min(3).max(1000)});
export const warehouseReview = versioned.extend({name:z.string().trim().min(1).max(200),address:z.string().trim().max(1000).nullable(),reason:z.string().trim().min(3).max(1000)});
export const warehouseGrant = command.extend({userId:id,warehouseId:id,expectedVersion:z.number().int().min(0),active:z.boolean(),reason:z.string().trim().min(3).max(1000)});
export const contextSwitch = z.object({companyId:id,warehouseId:id.nullable().optional()});
export const palletGroupCreate=command.extend({tripId:id,name:z.string().trim().min(1).max(120),reason:z.string().trim().min(3).max(1000)}).strict();
export const palletGroupChange=versioned.extend({palletId:id,reason:z.string().trim().min(3).max(1000)}).strict();
export const extractionRequest=command.extend({provider:z.enum(['local','gemini']),confirmExternalTransfer:z.boolean()}).strict().refine(p=>p.provider!=='gemini'||p.confirmExternalTransfer,'Confirm that this document will be sent to Google');
export const searchParams = z.object({
  entity: z.enum([
    'boxes',
    'products',
    'orders',
    'pallets',
    'locations',
    'shipments',
    'customers',
    'trips',
    'issues',
    'documents',
  ]),
  q: z.string().max(200).default(''),
  cursor: z.string().max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const packageSplit = versioned.extend({
  contentsId: id,
  quantity,
  locationId: id.optional(),
  catchWeight: quantity.optional(),
  packageCount: z.number().int().positive().optional(),
  reason: z.string().min(3).max(500),
});

export * from './inventory.js';
export * from './tasks.js';
export * from './transfers.js';
export * from './onboarding.js';
export * from './picking.js';
export * from './transport.js';
export * from './orders.js';
export * from './traceability.js';
export * from './offline-sync.js';
export * from './portal.js';
export * from './notifications.js';
export * from './adapters.js';
export * from './reports.js';

