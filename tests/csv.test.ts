import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,safeCsvCell,errorCsv} from '../packages/domain/csv.js';
import {proposedProducts} from '../packages/domain/imports.js';
const mapping={sku:0,name:1,name_zh:2,profile:3,unit:4,handling:null};
test('CSV preserves bilingual text, zero codes, quotes, commas, multiline and BOM/CRLF',()=>{
 const c=parseCsv('\uFEFFsku,name,name_zh,profile,unit\r\n0001,"Printed, ""special""\nline",中文,Printed goods,piece\r\n');
 assert.equal(c.rows[0].cells[0],'0001');assert.equal(c.rows[0].cells[1],'Printed, "special"\nline');assert.equal(c.rows[0].cells[2],'中文');assert.equal(c.rows[0].line,2);
});
test('CSV rejects malformed/oversize/invalid encoding and ambiguous missing header/rows',()=>{
 for(const s of ['a,b\n"unclosed','a,b\n"x"stuff,y','a,b\nva"lue,x','a,,b\nx,y,z','a,b\n','a,b\n\u0000,y','a,b\n\ufffd,y','a'.repeat(262145),'a\n'+Array(501).fill('x').join('\n')])assert.throws(()=>parseCsv(s));
});
test('CSV mapping rejects repeated/out-of-range columns, invalid units/profiles and duplicate SKUs',()=>{
 const csv='sku,name,name_zh,profile,unit\n001,Demo,,General goods,piece\n001,Demo,,General goods,boxes';
 const r=proposedProducts(csv,mapping);assert.equal(r.rows[0].values.name_zh,null);assert.equal(r.rows[0].issues.length,0);assert.ok(r.rows[1].issues.some(x=>x.field==='unit'));assert.ok(r.rows[1].issues.some(x=>x.field==='sku'));
 assert.throws(()=>proposedProducts(csv,{...mapping,sku:1}));assert.throws(()=>proposedProducts(csv,{...mapping,handling:39}));
 assert.ok(proposedProducts(csv.replace('001,Demo',' 001,Demo'),mapping).rows[0].issues.some(x=>x.field==='sku'));
 assert.ok(proposedProducts(csv.replace('General goods','unknown profile'),mapping).rows[0].issues.some(x=>x.field==='profile'));
});
test('CSV reports neutralize formula injection including leading whitespace and escaped quotes',()=>{
 for(const v of ['=1+1',' +SUM(A1)','\t@cmd','-1','\n=cmd'])assert.ok(safeCsvCell(v).startsWith('"\''));
 const csv=errorCsv({rows:[{line:2,values:{sku:'=HYPERLINK("x")'},issues:[{field:'sku',message:'Duplicate'}]}]});assert.ok(csv.includes("'="));assert.ok(csv.includes('""x""'));
});
