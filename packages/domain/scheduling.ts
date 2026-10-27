export function nextPreparationDate(from:string, days:number[]):string|null {
  if(!days.length) return null;
  // Calendar arithmetic uses UTC solely to represent date-only values (no DST hour addition).
  const date=new Date(from+'T12:00:00Z');
  if(!Number.isFinite(date.getTime())) return null;
  for(let i=0;i<7;i++) { if(days.includes(date.getUTCDay())) return date.toISOString().slice(0,10); date.setUTCDate(date.getUTCDate()+1); }
  return null;
}
