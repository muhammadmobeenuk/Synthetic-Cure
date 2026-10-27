// Bounded RFC-4180-style comma CSV. No delimiter, date, numeric or encoding guessing.
export class CsvError extends Error {}
export function parseCsv(source:string):{headers:string[];rows:{line:number;cells:string[]}[]} {
 if(new TextEncoder().encode(source).length>262144)throw new CsvError('CSV exceeds 256 KiB');
 if(/[\u0000\ufffd]/.test(source))throw new CsvError('CSV contains NUL or invalid UTF-8 replacement characters');
 source=source.replace(/^\uFEFF/,'');
 const records:{line:number;cells:string[]}[]=[];let cells:string[]=[],field='',quoted=false,closed=false,line=1,start=1;
 const cell=()=>{cells.push(field);field='';closed=false;if(cells.length>40)throw new CsvError('CSV exceeds 40 columns');};
 const row=()=>{cell();if(cells.some(c=>c!==''))records.push({line:start,cells});cells=[];if(records.length>501)throw new CsvError('CSV exceeds 500 data rows');};
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(quoted){if(c==='"'){if(source[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else{field+=c;if(c==='\n')line++;}continue;}
  if(c==='"'){if(field||closed)throw new CsvError('Unexpected quote at line '+line);quoted=true;continue;}
  if(c===','){cell();continue;}
  if(c==='\r'||c==='\n'){if(c==='\r'&&source[i+1]==='\n')i++;row();line++;start=line;continue;}
  if(closed)throw new CsvError('Unexpected text after quoted field at line '+line);
  field+=c;
 }
 if(quoted)throw new CsvError('Unclosed quoted field at line '+start);
 if(field||cells.length||closed)row();
 if(records.length<2)throw new CsvError('CSV needs a header and at least one nonblank data row');
 const headers=records.shift()!.cells;
 if(headers.some(h=>!h.trim()))throw new CsvError('Each column needs a nonblank header');
 return {headers,rows:records};
}
export function safeCsvCell(value:unknown){let s=String(value??'');if(/^[\s]*[=+\-@\t\r\n]/u.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
export function errorCsv(report:{rows:{line:number;values:Record<string,unknown>;issues:{field:string;message:string}[]}[]}){
 return '\uFEFF'+[['Source line','Product SKU','Field','Problem'],...report.rows.flatMap(r=>r.issues.map(i=>[r.line,r.values.sku,i.field,i.message]))].map(row=>row.map(safeCsvCell).join(',')).join('\r\n')+'\r\n';
}
