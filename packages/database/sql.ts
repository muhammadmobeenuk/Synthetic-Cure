// Migration splitter for PGlite's parameterized query interface. Never splits inside
// PostgreSQL strings, identifiers, comments or dollar-quoted function bodies.
export function splitStatements(sql:string):string[] {
  const result:string[]=[]; let start=0, i=0, mode:'code'|'single'|'double'|'line'|'block'|'dollar'='code', tag='', depth=0, hasCode=false;
  while(i<sql.length) {
    const c=sql[i], n=sql[i+1];
    if(mode==='line'){if(c==='\n')mode='code';i++;continue;}
    if(mode==='block'){if(c==='/'&&n==='*'){depth++;i+=2;}else if(c==='*'&&n==='/'){if(--depth===0)mode='code';i+=2;}else i++;continue;}
    if(mode==='dollar'){if(sql.startsWith(tag,i)){i+=tag.length;mode='code';}else i++;continue;}
    if(mode==='single'||mode==='double'){
      const quote=mode==='single'?"'":'"';
      if(c===quote&&n===quote){i+=2;continue;}
      if(c===quote)mode='code';
      i++;continue;
    }
    if(c==='-'&&n==='-'){mode='line';i+=2;continue;}
    if(c==='/'&&n==='*'){mode='block';depth=1;i+=2;continue;}
    if(c===';'){if(hasCode)result.push(sql.slice(start,i+1));start=++i;hasCode=false;continue;}
    if(!/\s/.test(c))hasCode=true;
    if(c==="'")mode='single';else if(c==='"')mode='double';else if(c==='$'){
      const match=sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if(match){tag=match[0];mode='dollar';i+=tag.length;continue;}
    }
    i++;
  }
  if(!['code','line'].includes(mode))throw new Error('Unterminated SQL literal/comment in migration');
  if(hasCode)result.push(sql.slice(start));
  return result;
}
