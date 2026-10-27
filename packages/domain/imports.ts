import {randomUUID as uuid} from 'node:crypto';
import type {DB} from '../database/index.js';
import Decimal from 'decimal.js';
import {canonical,requireRule,DomainError} from './index.js';
import {authorize,event,owned,version,type Actor} from './services.js';
import {parseCsv,CsvError,safeCsvCell} from './csv.js';
import {importedProduct,importFields,productMapping,productImportPreview,productImportCommit,type ProductMapping,csvImportPreview,csvImportCommit} from '../contracts/imports.js';
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

// ----------------- Multi-entity CSV Imports -----------------
export async function listCsvImports(t: DB, a: Actor, entityType?: string) {
  authorize(a, 'configure');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  let sql = 'SELECT id, org_id, warehouse_id, entity_type, source_filename, row_count, valid_count, error_count, status, cut_over_date, created_at FROM csv_imports WHERE org_id=$1 AND warehouse_id=$2';
  const params: any[] = [a.org_id, a.warehouse_id];
  if (entityType) {
    params.push(entityType);
    sql += ` AND entity_type = $${params.length}`;
  }
  sql += ' ORDER BY created_at DESC, id DESC LIMIT 100';
  return (await t.query(sql, params)).rows;
}

export async function reviewCsvImport(t: DB, a: Actor, id: string) {
  authorize(a, 'configure');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const imp = await owned(t, 'csv_imports', id, a);
  const errors = (
    await t.query(
      'SELECT row_number, field, message, raw_data FROM csv_import_errors WHERE import_id=$1 ORDER BY row_number, id',
      [id],
    )
  ).rows;
  return {
    ...imp,
    rowCount: imp.row_count,
    validCount: imp.valid_count,
    errorCount: imp.error_count,
    errors,
    canCommit: imp.status === 'preview' && imp.error_count === 0,
  };
}

export async function previewCsvImport(t: DB, a: Actor, payload: unknown) {
  authorize(a, 'configure');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = csvImportPreview.parse(payload);

  const parsed = (() => {
    try {
      return parseCsv(p.csv);
    } catch (e: any) {
      throw new DomainError(422, 'CSV_INVALID', e instanceof CsvError ? e.message : 'Invalid CSV');
    }
  })();

  const sourceHash = await digest(p.csv);
  const importId = uuid();

  // Normalize header map: name.toLowerCase() -> colIndex
  const headerMap = new Map<string, number>();
  parsed.headers.forEach((h, idx) => {
    headerMap.set(h.trim().toLowerCase(), idx);
  });

  const getCol = (key: string): number | undefined => {
    if (p.mapping && p.mapping[key] !== undefined) return p.mapping[key];
    return headerMap.get(key.toLowerCase());
  };

  const rows: { rowNum: number; data: Record<string, string>; issues: { field: string; message: string }[] }[] = [];
  const seenCodes = new Set<string>();

  for (const r of parsed.rows) {
    const issues: { field: string; message: string }[] = [];
    const getVal = (field: string) => {
      const idx = getCol(field);
      return idx !== undefined && idx < r.cells.length ? r.cells[idx].trim() : '';
    };

    const rowData: Record<string, string> = {};

    if (p.entityType === 'customers') {
      const code = getVal('code');
      const name = getVal('name');
      const nameZh = getVal('name_zh') || getVal('namezh');
      rowData.code = code;
      rowData.name = name;
      rowData.name_zh = nameZh;

      if (!code) issues.push({ field: 'code', message: 'Customer code is required' });
      else if (seenCodes.has(code)) issues.push({ field: 'code', message: `Duplicate customer code ${code} in CSV` });
      else {
        seenCodes.add(code);
        const existing = (await t.query('SELECT id FROM customers WHERE org_id=$1 AND code=$2', [a.org_id, code])).rows[0];
        if (existing) issues.push({ field: 'code', message: `Customer code ${code} already exists; create-only import cannot overwrite` });
      }
      if (!name) issues.push({ field: 'name', message: 'Customer name is required' });
    } else if (p.entityType === 'suppliers') {
      const code = getVal('code');
      const name = getVal('name');
      rowData.code = code;
      rowData.name = name;

      if (!code) issues.push({ field: 'code', message: 'Supplier code is required' });
      else if (seenCodes.has(code)) issues.push({ field: 'code', message: `Duplicate supplier code ${code} in CSV` });
      else {
        seenCodes.add(code);
        const existing = (await t.query('SELECT id FROM suppliers WHERE org_id=$1 AND code=$2', [a.org_id, code])).rows[0];
        if (existing) issues.push({ field: 'code', message: `Supplier code ${code} already exists; create-only import cannot overwrite` });
      }
      if (!name) issues.push({ field: 'name', message: 'Supplier name is required' });
    } else if (p.entityType === 'locations') {
      const code = getVal('code');
      const name = getVal('name');
      const kind = getVal('kind') || 'shelf';
      const capacity = getVal('capacity');
      const restrictions = getVal('restrictions');
      rowData.code = code;
      rowData.name = name;
      rowData.kind = kind;
      rowData.capacity = capacity;
      rowData.restrictions = restrictions;

      if (!code) issues.push({ field: 'code', message: 'Location code is required' });
      else if (seenCodes.has(code)) issues.push({ field: 'code', message: `Duplicate location code ${code} in CSV` });
      else {
        seenCodes.add(code);
        const existing = (await t.query('SELECT id FROM locations WHERE org_id=$1 AND warehouse_id=$2 AND code=$3', [a.org_id, a.warehouse_id, code])).rows[0];
        if (existing) issues.push({ field: 'code', message: `Location code ${code} already exists in warehouse; create-only import cannot overwrite` });
      }
      if (!name) issues.push({ field: 'name', message: 'Location name is required' });
      if (!['shelf', 'bin', 'rack', 'dock', 'staging'].includes(kind.toLowerCase())) {
        issues.push({ field: 'kind', message: `Invalid location kind ${kind}. Choose shelf, bin, rack, dock, or staging.` });
      }
    } else if (p.entityType === 'orders') {
      const code = getVal('code');
      const customerCode = getVal('customer_code');
      const destName = getVal('destination_name');
      const sku = getVal('sku');
      const qty = getVal('quantity');
      const unit = getVal('unit');
      rowData.code = code;
      rowData.customer_code = customerCode;
      rowData.destination_name = destName;
      rowData.sku = sku;
      rowData.quantity = qty;
      rowData.unit = unit;

      if (!code) issues.push({ field: 'code', message: 'Order code is required' });
      const cust = (await t.query('SELECT id FROM customers WHERE org_id=$1 AND code=$2', [a.org_id, customerCode])).rows[0];
      if (!cust) issues.push({ field: 'customer_code', message: `Customer ${customerCode} not found` });
      else {
        const dest = (await t.query('SELECT id FROM destinations WHERE org_id=$1 AND customer_id=$2 AND name=$3', [a.org_id, cust.id, destName])).rows[0];
        if (!dest) issues.push({ field: 'destination_name', message: `Destination ${destName} not found for customer ${customerCode}` });
      }
      const prod = (await t.query('SELECT id, unit FROM products WHERE org_id=$1 AND sku=$2', [a.org_id, sku])).rows[0];
      if (!prod) issues.push({ field: 'sku', message: `Product SKU ${sku} not found` });
      else if (unit !== prod.unit) issues.push({ field: 'unit', message: `Unit ${unit} does not match product base unit ${prod.unit}` });

      if (!qty || Number(qty) <= 0) issues.push({ field: 'quantity', message: 'Quantity must be positive' });
    } else if (p.entityType === 'expected_receipts') {
      const supplierCode = getVal('supplier_code');
      const sku = getVal('sku');
      const reference = getVal('reference');
      const expDate = getVal('expected_date');
      const qty = getVal('quantity');
      const unit = getVal('unit');
      rowData.supplier_code = supplierCode;
      rowData.sku = sku;
      rowData.reference = reference;
      rowData.expected_date = expDate;
      rowData.quantity = qty;
      rowData.unit = unit;

      const supp = (await t.query('SELECT id FROM suppliers WHERE org_id=$1 AND code=$2', [a.org_id, supplierCode])).rows[0];
      if (!supp) issues.push({ field: 'supplier_code', message: `Supplier ${supplierCode} not found` });

      const prod = (await t.query('SELECT id, unit FROM products WHERE org_id=$1 AND sku=$2', [a.org_id, sku])).rows[0];
      if (!prod) issues.push({ field: 'sku', message: `Product SKU ${sku} not found` });
      else if (unit !== prod.unit) issues.push({ field: 'unit', message: `Unit ${unit} does not match product base unit ${prod.unit}` });

      if (!reference) issues.push({ field: 'reference', message: 'Inbound reference is required' });
      if (!expDate || isNaN(Date.parse(expDate))) issues.push({ field: 'expected_date', message: 'Valid expected date is required' });
      if (!qty || Number(qty) <= 0) issues.push({ field: 'quantity', message: 'Quantity must be positive' });
    } else if (p.entityType === 'opening_stock') {
      const sku = getVal('sku');
      const locationCode = getVal('location_code');
      const qty = getVal('quantity');
      const unit = getVal('unit');
      const ownerCode = getVal('owner_code') || 'DEFAULT';
      const condition = getVal('condition') || 'good';
      rowData.sku = sku;
      rowData.location_code = locationCode;
      rowData.quantity = qty;
      rowData.unit = unit;
      rowData.owner_code = ownerCode;
      rowData.condition = condition;

      const prod = (await t.query('SELECT id, unit FROM products WHERE org_id=$1 AND sku=$2', [a.org_id, sku])).rows[0];
      if (!prod) issues.push({ field: 'sku', message: `Product SKU ${sku} not found` });
      else if (unit !== prod.unit) issues.push({ field: 'unit', message: `Unit ${unit} does not match product base unit ${prod.unit}` });

      const loc = (await t.query('SELECT id FROM locations WHERE org_id=$1 AND warehouse_id=$2 AND code=$3', [a.org_id, a.warehouse_id, locationCode])).rows[0];
      if (!loc) issues.push({ field: 'location_code', message: `Location ${locationCode} not found in current warehouse` });

      if (!qty || Number(qty) <= 0) issues.push({ field: 'quantity', message: 'Quantity must be positive' });
      if (!['good', 'damaged', 'hold'].includes(condition.toLowerCase())) {
        issues.push({ field: 'condition', message: `Invalid condition ${condition}. Must be good, damaged, or hold.` });
      }
    }

    rows.push({ rowNum: r.line, data: rowData, issues });
  }

  const validCount = rows.filter((r) => r.issues.length === 0).length;
  const errorCount = rows.filter((r) => r.issues.length > 0).length;

  await t.query(
    `INSERT INTO csv_imports(id, org_id, warehouse_id, entity_type, source_filename, source_hash, row_count, valid_count, error_count, status, raw_content, mapping, cut_over_date, reconciliation_notes, created_by)
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, 'preview', $10, $11, $12, $13, $14)`,
    [
      importId,
      a.org_id,
      a.warehouse_id,
      p.entityType,
      p.filename,
      sourceHash,
      rows.length,
      validCount,
      errorCount,
      p.csv,
      JSON.stringify(p.mapping || {}),
      p.cutOverDate || null,
      p.reconciliationNotes || null,
      a.id,
    ],
  );

  for (const r of rows) {
    for (const issue of r.issues) {
      await t.query(
        `INSERT INTO csv_import_errors(id, import_id, row_number, field, message, raw_data)
         VALUES($1, $2, $3, $4, $5, $6)`,
        [uuid(), importId, r.rowNum, issue.field, issue.message, JSON.stringify(r.data)],
      );
    }
  }

  await event(t, a, importId, 'csv_import.preview_created', {
    entityType: p.entityType,
    rowCount: rows.length,
    validCount,
    errorCount,
    cutOverDate: p.cutOverDate,
  });

  return reviewCsvImport(t, a, importId);
}

export async function commitCsvImport(
  t: DB,
  a: Actor,
  id: string,
  payload: unknown,
) {
  authorize(a, 'configure');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const p = csvImportCommit.parse(payload);
  const imp = await owned(t, 'csv_imports', id, a, true);
  version(imp, p.expectedVersion);
  requireRule(imp.status === 'preview', 'IMPORT_ALREADY_COMMITTED', 'This import was already committed or rejected', 409);
  requireRule(imp.error_count === 0, 'IMPORT_HAS_ERRORS', 'Cannot commit import with validation errors. Review and resolve all errors.', 422);

  const parsed = parseCsv(imp.raw_content);
  const headerMap = new Map<string, number>();
  parsed.headers.forEach((h, idx) => {
    headerMap.set(h.trim().toLowerCase(), idx);
  });
  const mapping = imp.mapping || {};
  const getCol = (key: string): number | undefined => {
    if (mapping[key] !== undefined) return mapping[key];
    return headerMap.get(key.toLowerCase());
  };

  if (imp.entity_type === 'customers') {
    for (const r of parsed.rows) {
      const getVal = (f: string) => {
        const idx = getCol(f);
        return idx !== undefined && idx < r.cells.length ? r.cells[idx].trim() : '';
      };
      await t.query(
        'INSERT INTO customers(id, org_id, code, name, name_zh) VALUES($1, $2, $3, $4, $5)',
        [uuid(), a.org_id, getVal('code'), getVal('name'), getVal('name_zh') || null],
      );
    }
  } else if (imp.entity_type === 'suppliers') {
    for (const r of parsed.rows) {
      const getVal = (f: string) => {
        const idx = getCol(f);
        return idx !== undefined && idx < r.cells.length ? r.cells[idx].trim() : '';
      };
      await t.query(
        'INSERT INTO suppliers(id, org_id, code, name) VALUES($1, $2, $3, $4)',
        [uuid(), a.org_id, getVal('code'), getVal('name')],
      );
    }
  } else if (imp.entity_type === 'locations') {
    for (const r of parsed.rows) {
      const getVal = (f: string) => {
        const idx = getCol(f);
        return idx !== undefined && idx < r.cells.length ? r.cells[idx].trim() : '';
      };
      const cap = getVal('capacity');
      await t.query(
        'INSERT INTO locations(id, org_id, warehouse_id, code, name, kind, capacity, restrictions) VALUES($1, $2, $3, $4, $5, $6, $7, $8)',
        [
          uuid(),
          a.org_id,
          a.warehouse_id,
          getVal('code'),
          getVal('name'),
          getVal('kind') || 'shelf',
          cap ? Number(cap) : null,
          getVal('restrictions') || null,
        ],
      );
    }
  } else if (imp.entity_type === 'orders') {
    // Group rows by order code
    const ordersMap = new Map<string, { customerCode: string; destinationName: string; lines: { sku: string; qty: string; unit: string }[] }>();
    for (const r of parsed.rows) {
      const getVal = (f: string) => {
        const idx = getCol(f);
        return idx !== undefined && idx < r.cells.length ? r.cells[idx].trim() : '';
      };
      const oCode = getVal('code');
      if (!ordersMap.has(oCode)) {
        ordersMap.set(oCode, {
          customerCode: getVal('customer_code'),
          destinationName: getVal('destination_name'),
          lines: [],
        });
      }
      ordersMap.get(oCode)!.lines.push({
        sku: getVal('sku'),
        qty: getVal('quantity'),
        unit: getVal('unit'),
      });
    }

    for (const [oCode, oData] of ordersMap.entries()) {
      const cust = (await t.query('SELECT id FROM customers WHERE org_id=$1 AND code=$2', [a.org_id, oData.customerCode])).rows[0];
      const dest = (await t.query('SELECT id FROM destinations WHERE org_id=$1 AND customer_id=$2 AND name=$3', [a.org_id, cust.id, oData.destinationName])).rows[0];
      const orderId = uuid();
      await t.query(
        'INSERT INTO orders(id, org_id, warehouse_id, code, customer_id, destination_id, status, version) VALUES($1, $2, $3, $4, $5, $6, $7, 1)',
        [orderId, a.org_id, a.warehouse_id, oCode, cust.id, dest.id, 'open'],
      );
      for (const line of oData.lines) {
        const prod = (await t.query('SELECT id FROM products WHERE org_id=$1 AND sku=$2', [a.org_id, line.sku])).rows[0];
        await t.query(
          'INSERT INTO order_lines(id, org_id, warehouse_id, order_id, product_id, quantity, unit) VALUES($1, $2, $3, $4, $5, $6, $7)',
          [uuid(), a.org_id, a.warehouse_id, orderId, prod.id, line.qty, line.unit],
        );
      }
    }
  } else if (imp.entity_type === 'expected_receipts') {
    for (const r of parsed.rows) {
      const getVal = (f: string) => {
        const idx = getCol(f);
        return idx !== undefined && idx < r.cells.length ? r.cells[idx].trim() : '';
      };
      const supp = (await t.query('SELECT id FROM suppliers WHERE org_id=$1 AND code=$2', [a.org_id, getVal('supplier_code')])).rows[0];
      const prod = (await t.query('SELECT id FROM products WHERE org_id=$1 AND sku=$2', [a.org_id, getVal('sku')])).rows[0];
      await t.query(
        'INSERT INTO expected_receipts(id, org_id, warehouse_id, supplier_id, product_id, reference, expected_date, quantity, unit, version) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)',
        [
          uuid(),
          a.org_id,
          a.warehouse_id,
          supp.id,
          prod.id,
          getVal('reference'),
          getVal('expected_date'),
          getVal('quantity'),
          getVal('unit'),
        ],
      );
    }
  } else if (imp.entity_type === 'opening_stock') {
    const ownerId = `${a.org_id}:default_owner`;
    for (const r of parsed.rows) {
      const getVal = (f: string) => {
        const idx = getCol(f);
        return idx !== undefined && idx < r.cells.length ? r.cells[idx].trim() : '';
      };
      const prod = (await t.query('SELECT id, unit FROM products WHERE org_id=$1 AND sku=$2', [a.org_id, getVal('sku')])).rows[0];
      const loc = (await t.query('SELECT id FROM locations WHERE org_id=$1 AND warehouse_id=$2 AND code=$3', [a.org_id, a.warehouse_id, getVal('location_code')])).rows[0];
      const qty = new Decimal(getVal('quantity'));
      const cond = getVal('condition') || 'good';
      const isHeld = cond.toLowerCase() === 'held' || cond.toLowerCase() === 'damaged';

      const existingBalRes = await t.query(
        'SELECT * FROM inventory_balances WHERE org_id=$1 AND warehouse_id=$2 AND product_id=$3 AND location_id=$4 AND owner_id=$5 AND unit=$6 FOR UPDATE',
        [a.org_id, a.warehouse_id, prod.id, loc.id, ownerId, prod.unit],
      );
      const existingBal = existingBalRes.rows[0];
      let balId: string;
      if (existingBal) {
        balId = existingBal.id;
        const nextOnHand = new Decimal(existingBal.on_hand).plus(qty);
        const nextAvail = isHeld ? new Decimal(existingBal.available) : new Decimal(existingBal.available).plus(qty);
        const nextHeld = isHeld ? new Decimal(existingBal.held).plus(qty) : new Decimal(existingBal.held);
        await t.query(
          'UPDATE inventory_balances SET on_hand=$1, available=$2, held=$3, version=version+1, updated_at=now() WHERE id=$4',
          [nextOnHand.toFixed(6), nextAvail.toFixed(6), nextHeld.toFixed(6), balId],
        );
      } else {
        balId = uuid();
        const onHand = qty.toFixed(6);
        const available = isHeld ? '0' : onHand;
        const held = isHeld ? onHand : '0';
        await t.query(
          `INSERT INTO inventory_balances(id, org_id, warehouse_id, product_id, location_id, owner_id, unit, on_hand, reserved, available, picked, in_transit, held, dispatched, version)
           VALUES($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, 0, 0, $10, 0, 1)`,
          [balId, a.org_id, a.warehouse_id, prod.id, loc.id, ownerId, prod.unit, onHand, available, held],
        );
      }

      // Ledger record
      await t.query(
        `INSERT INTO inventory_ledger(id, org_id, warehouse_id, product_id, location_id, owner_id, quantity_delta, unit, state, reference_type, reference_id, notes, actor_id)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, 'opening_stock', $10, $11, $12)`,
        [
          uuid(),
          a.org_id,
          a.warehouse_id,
          prod.id,
          loc.id,
          ownerId,
          qty.toFixed(6),
          prod.unit,
          isHeld ? 'held' : 'available',
          imp.id,
          `Opening cut-over: ${imp.cut_over_date}`,
          a.id,
        ],
      );
    }

    await event(t, a, imp.id, 'opening_stock.reconciled', {
      cutOverDate: imp.cut_over_date,
      reconciliationNotes: imp.reconciliation_notes,
      itemCount: imp.row_count,
    });
  }

  await t.query(
    "UPDATE csv_imports SET status='committed', version=version+1 WHERE id=$1",
    [id],
  );

  await event(t, a, id, 'csv_import.committed', {
    entityType: imp.entity_type,
    rowCount: imp.row_count,
    reason: p.reason,
  });

  return reviewCsvImport(t, a, id);
}

export async function exportCsvImportErrors(t: DB, a: Actor, id: string): Promise<string> {
  authorize(a, 'configure');
  const errors = (
    await t.query(
      'SELECT row_number, field, message, raw_data FROM csv_import_errors WHERE import_id=$1 ORDER BY row_number, id',
      [id],
    )
  ).rows;
  const header = ['Row Number', 'Field', 'Message', 'Data'];
  const lines = [header.join(',')];
  for (const e of errors) {
    lines.push([e.row_number, safeCsvCell(e.field), safeCsvCell(e.message), safeCsvCell(JSON.stringify(e.raw_data))].join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

