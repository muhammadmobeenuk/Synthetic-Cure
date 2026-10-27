import {role as roleSchema} from "../contracts/index.js";
import type {DB} from '../database/index.js';
import type {Actor} from './services.js';
import {requireRule} from './index.js';
export const warehouseTables=new Set(['expected_receipts','pallet_groups','product_imports','locations','pallets','boxes','contents','orders','order_lines','allocations','preparations','preparation_orders','trips','stops','shipments','shipment_lines','documents','issues','counts','count_observations','inventory_events','operations','jobs']);
export const legacyWarehouse=(org:string)=>org+':legacy';
export async function contexts(t:DB,userId:string){
  return (await t.query(`SELECT m.org_id,m.role,o.name FROM company_memberships m JOIN organizations o ON o.id=m.org_id JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.active AND u.active ORDER BY o.name,m.org_id`,[userId])).rows.filter(r=>roleSchema.safeParse(r.role).success);
}
export async function permittedWarehouses(t:DB,a:Pick<Actor,'id'|'org_id'>){
  return (await t.query(`SELECT w.* FROM warehouses w JOIN warehouse_grants g ON g.warehouse_id=w.id AND g.org_id=w.org_id JOIN company_memberships m ON m.user_id=g.user_id AND m.org_id=g.org_id WHERE g.user_id=$1 AND g.org_id=$2 AND g.active AND w.active AND m.active ORDER BY w.code,w.id`,[a.id,a.org_id])).rows;
}
export async function resolveActor(t:DB,userId:string,company?:string,warehouse?:string|null):Promise<Actor|null>{
  const identity=(await t.query('SELECT id,org_id,name,email FROM users WHERE id=$1 AND active',[userId])).rows[0];
  if(!identity)return null;
  const memberships=await contexts(t,userId);
  const selected=company ? memberships.find(m=>m.org_id===company) : memberships.find(m=>m.org_id===identity.org_id)||memberships[0];
  if(!selected)return null;
  const a:Actor={...identity,org_id:selected.org_id,role:selected.role,warehouse_id:null,home_org_id:identity.org_id};
  const allowed=await permittedWarehouses(t,a);
  a.warehouse_id=warehouse===undefined ? (allowed[0]?.id||null) : (allowed.some(w=>w.id===warehouse)?warehouse:null);
  return a;
}
export async function validateActor(t:DB,a:Actor){
  const member=(await t.query(`SELECT m.role FROM company_memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.org_id=$2 AND m.active AND u.active FOR SHARE OF m,u`,[a.id,a.org_id])).rows[0];
  requireRule(member&&member.role===a.role,'ACCESS_CHANGED','Company access or role changed. Reopen your session; pending work remains.',403);
  if(a.warehouse_id){
    const grant=(await t.query(`SELECT w.id FROM warehouse_grants g JOIN warehouses w ON w.id=g.warehouse_id AND w.org_id=g.org_id WHERE g.user_id=$1 AND g.org_id=$2 AND g.warehouse_id=$3 AND g.active AND w.active FOR SHARE OF g,w`,[a.id,a.org_id,a.warehouse_id])).rows[0];
    requireRule(grant,'WAREHOUSE_ACCESS','Warehouse access changed. Select an authorized warehouse; pending work remains.',403);
  }
}
