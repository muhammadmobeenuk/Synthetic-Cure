import {randomUUID as uuid} from 'node:crypto';
import Decimal from 'decimal.js';
import type {DB} from '../database/index.js';
import {supplierCreate,expectedCreate,expectedReceive,expectedCancel} from '../contracts/inbound.js';
import {authorize,owned,version,event,services,type Actor} from './services.js';
import {requireRule} from './index.js';

export async function inboundList(t:DB,a:Actor){
 authorize(a,'receive');requireRule(a.warehouse_id,'WAREHOUSE_ACCESS','Select an assigned warehouse',403);
 const suppliers=(await t.query('SELECT id,code,name FROM suppliers WHERE org_id=$1 ORDER BY code,id LIMIT 200',[a.org_id])).rows;
 const expectations=(await t.query(`SELECT e.*,s.code supplier_code,s.name supplier_name,p.sku,p.name product_name,p.name_zh,
 COALESCE(SUM(r.quantity),0)::text received,
 COALESCE(SUM(r.quantity) FILTER (WHERE r.receipt_state='accepted'),0)::text accepted,
 COALESCE(SUM(r.quantity) FILTER (WHERE r.receipt_state='held'),0)::text held,
 COALESCE(SUM(r.quantity) FILTER (WHERE r.receipt_state='pending'),0)::text pending,
 EXISTS(SELECT 1 FROM inventory_events ev WHERE ev.org_id=e.org_id AND ev.warehouse_id=e.warehouse_id AND ev.entity_id=e.id AND ev.kind='inbound.expectation_cancelled') AS cancelled,
 (SELECT ev.data->>'reason' FROM inventory_events ev WHERE ev.org_id=e.org_id AND ev.warehouse_id=e.warehouse_id AND ev.entity_id=e.id AND ev.kind='inbound.expectation_cancelled') AS cancellation_reason
 FROM expected_receipts e JOIN suppliers s ON s.id=e.supplier_id AND s.org_id=e.org_id JOIN products p ON p.id=e.product_id AND p.org_id=e.org_id
 LEFT JOIN expected_receipt_boxes r ON r.expected_receipt_id=e.id AND r.org_id=e.org_id AND r.warehouse_id=e.warehouse_id
 WHERE e.org_id=$1 AND e.warehouse_id=$2 GROUP BY e.id,s.code,s.name,p.sku,p.name,p.name_zh ORDER BY e.created_at DESC,e.id DESC LIMIT 200`,[a.org_id,a.warehouse_id])).rows;
 return {suppliers,expectations:expectations.map(e=>{const remaining=new Decimal(e.quantity).minus(e.received).toFixed();return {...e,outstanding:e.cancelled?'0':remaining,cancelled_quantity:e.cancelled?remaining:'0'};}),limit:200};
}
export async function createSupplier(t:DB,a:Actor,payload:unknown){
 authorize(a,'configure');const p=supplierCreate.parse(payload);const existing=(await t.query('SELECT id FROM suppliers WHERE org_id=$1 AND code=$2',[a.org_id,p.code])).rows[0];requireRule(!existing,'DUPLICATE_SUPPLIER','Supplier code already exists',409);
 const id=uuid();const inserted=await t.query('INSERT INTO suppliers(id,org_id,code,name) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,code) DO NOTHING RETURNING id',[id,a.org_id,p.code,p.name]);requireRule(inserted.rows.length,'DUPLICATE_SUPPLIER','Supplier code already exists',409);await event(t,a,id,'supplier.created',{code:p.code});return {id,code:p.code,name:p.name};
}
export async function createExpectedReceipt(t:DB,a:Actor,payload:unknown){
 authorize(a,'receive');const p=expectedCreate.parse(payload);requireRule(a.warehouse_id,'WAREHOUSE_ACCESS','Select an assigned warehouse',403);
 await owned(t,'suppliers',p.supplierId,a);const product=await owned(t,'products',p.productId,a);requireRule(product.unit===p.unit,'UNIT_MISMATCH','Use the product base unit');
 const id=uuid();await t.query('INSERT INTO expected_receipts(id,org_id,warehouse_id,supplier_id,product_id,reference,expected_date,quantity,unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,a.org_id,a.warehouse_id,p.supplierId,p.productId,p.reference,p.expectedDate,p.quantity,p.unit]);
 await event(t,a,id,'inbound.expected',{supplierId:p.supplierId,productId:p.productId,reference:p.reference,expectedDate:p.expectedDate,quantity:p.quantity,unit:p.unit});return owned(t,'expected_receipts',id,a);
}
export async function receiveExpectedBox(t:DB,a:Actor,id:string,payload:unknown){
 authorize(a,'receive');const p=expectedReceive.parse(payload),expected=await owned(t,'expected_receipts',id,a,true);version(expected,p.expectedVersion);
 requireRule(!(await t.query("SELECT id FROM inventory_events WHERE org_id=$1 AND warehouse_id=$2 AND entity_id=$3 AND kind='inbound.expectation_cancelled'",[a.org_id,a.warehouse_id,id])).rows.length,'EXPECTED_CANCELLED','This expectation was canceled and cannot receive more boxes',409);
 const total=(await t.query('SELECT COALESCE(SUM(quantity),0)::text total FROM expected_receipt_boxes WHERE expected_receipt_id=$1 AND org_id=$2 AND warehouse_id=$3',[id,a.org_id,a.warehouse_id])).rows[0].total;
 requireRule(new Decimal(total).plus(p.quantity).lte(expected.quantity),'OVER_RECEIPT','Quantity exceeds the outstanding expected amount. Record an exception for review.',409);
 const box=await services.receipt(t,a,{customerId:null,locationId:p.locationId,sourceLabel:p.sourceLabel,condition:p.condition,contents:[{productId:expected.product_id,quantity:p.quantity,unit:expected.unit,verified:true}]});
 const state=box.status==='hold'?'held':box.status==='confirmed'?'accepted':'pending';
 await t.query('INSERT INTO expected_receipt_boxes(id,org_id,warehouse_id,expected_receipt_id,box_id,quantity,unit,receipt_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uuid(),a.org_id,a.warehouse_id,id,box.id,p.quantity,expected.unit,state]);
 await t.query('UPDATE expected_receipts SET version=version+1 WHERE id=$1',[id]);
 await event(t,a,id,'inbound.box_received',{boxId:box.id,quantity:p.quantity,unit:expected.unit,receiptState:state});return {box,expected:await owned(t,'expected_receipts',id,a)};
}
export async function cancelExpectedReceipt(t:DB,a:Actor,id:string,payload:unknown){
 authorize(a,'adjust');const p=expectedCancel.parse(payload),expected=await owned(t,'expected_receipts',id,a,true);version(expected,p.expectedVersion);
 requireRule(!(await t.query("SELECT id FROM inventory_events WHERE org_id=$1 AND warehouse_id=$2 AND entity_id=$3 AND kind='inbound.expectation_cancelled'",[a.org_id,a.warehouse_id,id])).rows.length,'EXPECTED_CANCELLED','This expectation is already canceled',409);
 const received=(await t.query('SELECT COALESCE(SUM(quantity),0)::text total FROM expected_receipt_boxes WHERE expected_receipt_id=$1 AND org_id=$2 AND warehouse_id=$3',[id,a.org_id,a.warehouse_id])).rows[0].total;
 const remaining=new Decimal(expected.quantity).minus(received);requireRule(remaining.gt(0),'EXPECTED_COMPLETE','This expectation has no outstanding quantity to cancel',409);
 await t.query('UPDATE expected_receipts SET version=version+1 WHERE id=$1',[id]);
 await event(t,a,id,'inbound.expectation_cancelled',{reason:p.reason,cancelledQuantity:remaining.toFixed(),unit:expected.unit,receivedQuantity:received});
 return {...await owned(t,'expected_receipts',id,a),cancelled:true,cancelledQuantity:remaining.toFixed()};
}
