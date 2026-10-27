import {z} from 'zod';
import {command,versioned,id,quantity} from './index.js';
export const supplierCreate=command.extend({code:z.string().trim().min(1).max(120),name:z.string().trim().min(1).max(200)}).strict();
export const expectedCreate=command.extend({supplierId:id,productId:id,reference:z.string().trim().min(1).max(200),expectedDate:z.iso.date(),quantity,unit:z.string().min(1).max(30)}).strict();
export const expectedReceive=versioned.extend({locationId:id,quantity,condition:z.enum(['good','damaged','hold']),sourceLabel:z.string().max(2000).default('')}).strict();
export const expectedCancel=versioned.extend({reason:z.string().trim().min(3).max(1000)}).strict();
