import {randomUUID as uuid} from 'node:crypto';
import type {DB} from '../database/index.js';
import {authorize,owned,event,version,type Actor} from './services.js';
import {requireRule} from './index.js';
import {palletGroupCreate,palletGroupChange} from '../contracts/index.js';
export async function palletGroupList(t:DB,a:Actor){
 authorize(a,'dispatch');requireRule(a.warehouse_id,'WAREHOUSE_ACCESS','Select an assigned warehouse',403);
 const groups=(await t.query(`SELECT g.*,t.code trip_code,t.business_date,t.driver_id,u.name driver_name,t.vehicle FROM pallet_groups g JOIN trips t ON t.id=g.trip_id AND t.warehouse_id=g.warehouse_id LEFT JOIN users u ON u.id=t.driver_id WHERE g.org_id=$1 AND g.warehouse_id=$2 ORDER BY g.created_at DESC,g.id DESC LIMIT 100`,[a.org_id,a.warehouse_id])).rows;
 const members=(await t.query(`SELECT m.group_id,m.pallet_id,p.code,p.location_id,l.code location_code,p.manifest_revision,p.checked_revision,(SELECT count(*)::int FROM boxes b WHERE b.pallet_id=p.id AND b.warehouse_id=m.warehouse_id) box_count FROM pallet_group_memberships m JOIN pallets p ON p.id=m.pallet_id AND p.warehouse_id=m.warehouse_id JOIN locations l ON l.id=p.location_id WHERE m.org_id=$1 AND m.warehouse_id=$2 AND m.removed_at IS NULL ORDER BY p.code,p.id`,[a.org_id,a.warehouse_id])).rows;
 return groups.map(g=>({...g,pallets:members.filter(m=>m.group_id===g.id)}));
}
export async function createPalletGroup(t:DB,a:Actor,payload:unknown){
 authorize(a,'dispatch');const p=palletGroupCreate.parse(payload);requireRule(a.warehouse_id,'WAREHOUSE_ACCESS','Select an assigned warehouse',403);
 const trip=await owned(t,'trips',p.tripId,a,true);requireRule(trip.status==='planned','TRIP_STATE','Choose a planned trip');const id=uuid();
 await t.query('INSERT INTO pallet_groups(id,org_id,warehouse_id,trip_id,name) VALUES($1,$2,$3,$4,$5)',[id,a.org_id,a.warehouse_id,trip.id,p.name]);
 await event(t,a,id,'pallet_group.created',{tripId:trip.id,name:p.name,reason:p.reason,planningOnly:true});return owned(t,'pallet_groups',id,a);
}
export async function changePalletGroup(t:DB,a:Actor,id:string,payload:unknown,remove:boolean){
 authorize(a,'dispatch');const p=palletGroupChange.parse(payload),group=await owned(t,'pallet_groups',id,a,true);version(group,p.expectedVersion);
 const trip=await owned(t,'trips',group.trip_id,a,true);requireRule(trip.status==='planned','TRIP_STATE','Group membership can be changed only for a planned trip');
 const pallet=await owned(t,'pallets',p.palletId,a,true);
 const active=(await t.query('SELECT * FROM pallet_group_memberships WHERE org_id=$1 AND warehouse_id=$2 AND pallet_id=$3 AND removed_at IS NULL FOR UPDATE',[a.org_id,a.warehouse_id,p.palletId])).rows[0];
 if(remove){requireRule(active&&active.group_id===id,'GROUP_MEMBERSHIP','This pallet is not in this group',409);await t.query('UPDATE pallet_group_memberships SET removed_at=now(),removed_by=$1 WHERE id=$2',[a.id,active.id]);}
 else {requireRule(!active,'GROUP_MEMBERSHIP','Pallet is already assigned to an active group',409);await t.query('INSERT INTO pallet_group_memberships(id,org_id,warehouse_id,group_id,pallet_id,added_by) VALUES($1,$2,$3,$4,$5,$6)',[uuid(),a.org_id,a.warehouse_id,id,pallet.id,a.id]);}
 await t.query('UPDATE pallet_groups SET version=version+1 WHERE id=$1',[id]);await event(t,a,id,remove?'pallet_group.pallet_removed':'pallet_group.pallet_added',{palletId:pallet.id,tripId:trip.id,reason:p.reason,planningOnly:true});return owned(t,'pallet_groups',id,a);
}
