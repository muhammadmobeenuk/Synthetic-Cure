import {randomUUID as uuid} from 'node:crypto';
import type {DB} from '../database/index.js';
import {canonical,requireRule} from './index.js';
import {authorize,event,owned,version,type Actor} from './services.js';
import {parseCsv,CsvError} from './csv.js';
import {importedProduct,importFields,productMapping,productImportPreview,productImportCommit,type ProductMapping} from '../contracts/imports.js';
async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export type ImportIssue={field:string;message:string};
export function proposedProducts(csv:string,mapping:ProductMapping){
 const parsed=(()=>{try{return parseCsv(csv)}catch(e){requireRule(false,'CSV_INVALID',e instanceof CsvError?e.message:'Invalid CSV')}})();
 const m=productMapping.parse(mapping);
 requireRule(Object.values(m).every(i=>i===null||i<parsed.headers.length),'MAPPING_INVALID','A mapped column is absent from the header');
 const seen=new Map<string,number>();
 const rows=parsed.rows.map(row=>{
  const values=Object.fromEntries(importFields.map(f=>[f,m[f]===null?null:(row.cells[m[f]!]??'')])) as Record<string,any>;
  for(const key of ['name_zh','handling'])if(values[key]==='')values[key]=null;
  const result=importedProduct.safeParse(values),issues:ImportIssue[]=result.success?[]:result.error.issues.map(e=>({field:e.path.join('.'),message:e.message}));
  if(row.cells.length!==parsed.headers.length)issues.push({field:'row',message:`Expected ${parsed.headers.length} columns; found ${row.cells.length}`});
  if(values.sku){const first=seen.get(values.sku);if(first!==undefined)issues.push({field:'sku',message:'Duplicate SKU in CSV; first seen at line '+first});else seen.set(values.sku,row.line);}
  return {line:row.line,values,issues};
 });
 return {headers:parsed.headers,ignoredColumns:parsed.headers.map((name,i)=>({name,index:i})).filter(c=>!Object.values(m).includes(c.index)),rows};
}
async function scoped(t:DB,a:Actor,id:string,lock=false){authorize(a,'configure');requireRule(a.warehouse_id,'WAREHOUSE_ACCESS','Select an assigned warehouse',403);return owned(t,'product_imports',id,a,lock);}
export async function reviewProductImport(t:DB,a:Actor,id:string){
 const batch=await scoped(t,a,id);
 const proposal=proposedProducts(batch.source_csv,batch.mapping);
 const links=(await t.query('SELECT source_line,product_id FROM product_import_items WHERE import_id=$1 AND org_id=$2 AND warehouse_id=$3 ORDER BY source_line',[id,a.org_id,a.warehouse_id])).rows;
 const existing=new Set((await t.query('SELECT sku FROM products WHERE org_id=$1 AND sku=ANY($2::text[])',[a.org_id,proposal.rows.map(r=>r.values.sku)])).rows.map(r=>r.sku));
 for(const r of proposal.rows)if(batch.status!=='committed'&&existing.has(r.values.sku))r.issues.push({field:'sku',message:'SKU already exists in this company; create-only import cannot overwrite it'});
 return {...batch,...proposal,productIds:links.map(l=>l.product_id),totals:{rows:proposal.rows.length,valid:proposal.rows.filter(r=>!r.issues.length).length,invalid:proposal.rows.filter(r=>r.issues.length).length},canCommit:batch.status==='review'&&proposal.rows.every(r=>!r.issues.length)};
}
export async function previewProductImport(t:DB,a:Actor,payload:unknown){
 authorize(a,'configure');const p=productImportPreview.parse(payload);requireRule(a.warehouse_id,'WAREHOUSE_ACCESS','Select an assigned warehouse',403);
 proposedProducts(p.csv,p.mapping);
 const sourceHash=await digest(p.csv),identityHash=await digest(canonical({csv:p.csv,mapping:p.mapping,policy:1}));
 if(t.native)await t.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[a.org_id+':product-import:'+a.warehouse_id+':'+identityHash]);
 const old=(await t.query('SELECT id FROM product_imports WHERE org_id=$1 AND warehouse_id=$2 AND identity_hash=$3',[a.org_id,a.warehouse_id,identityHash])).rows[0];
 if(old)return reviewProductImport(t,a,old.id);
 const id=uuid();await t.query('INSERT INTO product_imports(id,org_id,warehouse_id,actor_id,filename,source_csv,source_hash,identity_hash,mapping,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,a.org_id,a.warehouse_id,a.id,p.filename,p.csv,sourceHash,identityHash,JSON.stringify(p.mapping),p.reason]);
 await event(t,a,id,'product_import.review_saved',{sourceHash,policyVersion:1,stockChanged:false});
 return reviewProductImport(t,a,id);
}
export async function commitProductImport(t:DB,a:Actor,id:string,payload:unknown){
 authorize(a,'configure');const p=productImportCommit.parse(payload),batch=await scoped(t,a,id,true);
 if(batch.status==='committed')return reviewProductImport(t,a,id);
 version(batch,p.expectedVersion);
 // Blocks concurrent catalogue INSERTs for the short bounded validation+insert transaction.
 // Native behavior must still be proven by native integration tests before production use.
 if(t.native)await t.query('LOCK TABLE products IN SHARE ROW EXCLUSIVE MODE');
 const report=await reviewProductImport(t,a,id);
 requireRule(report.canCommit,'IMPORT_REVIEW_REQUIRED','Catalogue validation failed. Review the refreshed report; no products were added.',409,report);
 for(const r of report.rows){const value=importedProduct.parse(r.values),productId=uuid();await t.query('INSERT INTO products(id,org_id,sku,name,name_zh,profile,unit,handling) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[productId,a.org_id,value.sku,value.name,value.name_zh,value.profile,value.unit,value.handling]);await t.query('INSERT INTO product_import_items(import_id,org_id,warehouse_id,source_line,product_id) VALUES($1,$2,$3,$4,$5)',[id,a.org_id,a.warehouse_id,r.line,productId]);await event(t,a,productId,'products.imported',{importId:id,sourceLine:r.line,sourceHash:batch.source_hash,policyVersion:1});}
 await t.query("UPDATE product_imports SET status='committed',version=version+1,committed_at=now() WHERE id=$1",[id]);
 await event(t,a,id,'product_import.committed',{productCount:report.rows.length,stockChanged:false,sourceHash:batch.source_hash,policyVersion:1});
 return reviewProductImport(t,a,id);
}
export async function listProductImports(t:DB,a:Actor,before?:string){
 authorize(a,'configure');let cursor:{createdAt:string;id:string}|null=null;
 if(before){try{cursor=JSON.parse(decodeURIComponent(before));requireRule(cursor&&typeof cursor.id==='string'&&cursor.id.length<=120&&typeof cursor.createdAt==='string'&&Number.isFinite(Date.parse(cursor.createdAt)),'CURSOR','Invalid cursor')}catch{requireRule(false,'CURSOR','Invalid cursor')}}
 const rows=(await t.query(`SELECT id,filename,status,version,created_at::text AS created_at,committed_at FROM product_imports WHERE org_id=$1 AND warehouse_id=$2 ${cursor?'AND (created_at,id)<($3::timestamptz,$4)':''} ORDER BY created_at DESC,id DESC LIMIT 21`,cursor?[a.org_id,a.warehouse_id,cursor.createdAt,cursor.id]:[a.org_id,a.warehouse_id])).rows;
 const items=rows.slice(0,20),last=items.at(-1);return {items,nextCursor:rows.length>20?encodeURIComponent(JSON.stringify({createdAt:last.created_at,id:last.id})):null};
}
