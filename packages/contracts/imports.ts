import { z } from 'zod';
import { command, versioned, id } from './primitives.js';
export const productProfiles=['Printed goods','General goods','Fresh produce','Chilled','Frozen','Fragile','Mixed contents'] as const;
export const productUnits=['piece','kg','case','litre'] as const;
const identityText=(max:number)=>z.string().min(1).max(max).refine(s=>s===s.trim(),'Remove leading/trailing whitespace explicitly').refine(s=>!/[\u0000-\u001f\u007f]/.test(s),'Control characters are not allowed');
export const importedProduct=z.object({sku:identityText(80),name:identityText(200),name_zh:z.string().max(200).nullable(),profile:z.enum(productProfiles),unit:z.enum(productUnits),handling:z.string().max(1000).nullable()});
export const importFields=['sku','name','name_zh','profile','unit','handling'] as const;
const column=z.number().int().min(0).max(39);
export const productMapping=z.object({sku:column,name:column,profile:column,unit:column,name_zh:column.nullable(),handling:column.nullable()}).strict().refine(m=>{const cols=Object.values(m).filter(v=>v!==null);return new Set(cols).size===cols.length},'Map each source column to at most one field');
export const productImportPreview=command.extend({filename:z.string().min(1).max(200),csv:z.string().min(1).max(262144),mapping:productMapping,reason:z.string().trim().min(3).max(1000)}).strict();
export const productImportCommit=versioned.strict();
export type ProductMapping=z.infer<typeof productMapping>;

export const entityTypes = ['customers', 'suppliers', 'locations', 'orders', 'expected_receipts', 'opening_stock'] as const;
export const csvImportPreview = command
  .extend({
    entityType: z.enum(entityTypes),
    filename: z.string().min(1).max(200),
    csv: z.string().min(1).max(1048576),
    mapping: z.record(z.string(), z.number().int().min(0).max(50)).optional(),
    cutOverDate: z.iso.date().optional(),
    reconciliationNotes: z.string().max(2000).optional(),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict()
  .refine(
    (p) => p.entityType !== 'opening_stock' || (p.cutOverDate !== undefined && p.cutOverDate.length > 0),
    'Opening stock import requires an explicit cut-over date',
  );

export const csvImportCommit = versioned
  .extend({
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

