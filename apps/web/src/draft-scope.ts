export type Identity={id:string;org_id:string;warehouse_id?:string|null;home_org_id?:string};
export const draftScope=(u:Identity)=>u.org_id+':'+(u.warehouse_id||'none')+':'+u.id;
export function legacyDraftScopes(u:Identity):string[]{
 // The old application had one company and one namespace. Never recover those drafts into another warehouse/company.
 if(u.warehouse_id!==u.org_id+':legacy'||(u.home_org_id&&u.home_org_id!==u.org_id))return [];
 return [u.org_id+':'+u.id,...((u.home_org_id||u.org_id)===u.org_id?[u.id]:[])];
}
