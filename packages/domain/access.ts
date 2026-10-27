import {randomUUID as uuid} from 'node:crypto';
import bcrypt from 'bcryptjs';
import type {DB} from '../database/index.js';
import {authorize,event,version,type Actor} from './services.js';
import {requireRule} from './index.js';
import * as schemas from '../contracts/index.js';
export async function accessDirectory(t:DB,a:Actor){
 authorize(a,'manage_access');
 return {
  members:(await t.query('SELECT m.*,u.email,u.name,u.active identity_active FROM company_memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 ORDER BY u.name,m.user_id',[a.org_id])).rows,
  warehouses:(await t.query('SELECT * FROM warehouses WHERE org_id=$1 ORDER BY code,id',[a.org_id])).rows,
  grants:(await t.query('SELECT * FROM warehouse_grants WHERE org_id=$1 ORDER BY warehouse_id,user_id',[a.org_id])).rows,
 };
}
async function companyLock(t:DB,a:Actor){await t.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[a.org_id]);}
export async function changeMembership(t:DB,a:Actor,payload:unknown){
 authorize(a,'manage_access'); const p=schemas.membershipChange.parse(payload); await companyLock(t,a);
 const user=(await t.query('SELECT id,email,name,active FROM users WHERE lower(email)=lower($1)',[p.email])).rows[0];
 requireRule(user,'IDENTITY_REQUIRED','Staff identity must be provisioned before company membership can be granted',422);
 const old=(await t.query('SELECT * FROM company_memberships WHERE org_id=$1 AND user_id=$2 FOR UPDATE',[a.org_id,user.id])).rows[0];
 version(old||{version:0},p.expectedVersion);
 if(old?.active&&old.role==='administrator'&&(!p.active||p.role!=='administrator')){
  const admins=(await t.query(`SELECT m.user_id FROM company_memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.active AND m.role='administrator' AND u.active`,[a.org_id])).rows;
  requireRule(admins.some(r=>r.user_id!==user.id),'LAST_ADMINISTRATOR','Keep at least one active company administrator');
 }
 await t.query(`INSERT INTO company_memberships(user_id,org_id,role,active) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,org_id) DO UPDATE SET role=$3,active=$4,version=company_memberships.version+1`,[user.id,a.org_id,p.role,p.active]);
 await event(t,a,user.id,'access.membership_changed',{previous:old||null,role:p.role,active:p.active,reason:p.reason});
 return (await t.query('SELECT * FROM company_memberships WHERE org_id=$1 AND user_id=$2',[a.org_id,user.id])).rows[0];
}
export async function createWarehouse(t:DB,a:Actor,payload:unknown){
 authorize(a,'manage_access'); const p=schemas.warehouseCreate.parse(payload),id=uuid();
 await t.query('INSERT INTO warehouses(id,org_id,code,name,address,identity_confirmed) VALUES($1,$2,$3,$4,$5,true)',[id,a.org_id,p.code,p.name,p.address]);
 await t.query('INSERT INTO warehouse_grants(user_id,org_id,warehouse_id) VALUES($1,$2,$3)',[a.id,a.org_id,id]);
 await event(t,a,id,'warehouse.created',{code:p.code,name:p.name,address:p.address,reason:p.reason,initialGrant:a.id});
 return (await t.query('SELECT * FROM warehouses WHERE id=$1 AND org_id=$2',[id,a.org_id])).rows[0];
}
export async function reviewWarehouse(t:DB,a:Actor,id:string,payload:unknown){
 authorize(a,'manage_access');const p=schemas.warehouseReview.parse(payload);
 const old=(await t.query('SELECT * FROM warehouses WHERE id=$1 AND org_id=$2 FOR UPDATE',[id,a.org_id])).rows[0];
 requireRule(old,'NOT_FOUND','Warehouse not found',404);version(old,p.expectedVersion);
 await t.query('UPDATE warehouses SET name=$1,address=$2,identity_confirmed=true,version=version+1 WHERE id=$3',[p.name,p.address,id]);
 await event(t,a,id,'warehouse.identity_reviewed',{previous:old,name:p.name,address:p.address,reason:p.reason});
 return (await t.query('SELECT * FROM warehouses WHERE id=$1',[id])).rows[0];
}
export async function changeWarehouseGrant(t:DB,a:Actor,payload:unknown){
 authorize(a,'manage_access');const p=schemas.warehouseGrant.parse(payload);await companyLock(t,a);
 requireRule((await t.query('SELECT user_id FROM company_memberships WHERE user_id=$1 AND org_id=$2 AND active',[p.userId,a.org_id])).rows.length,'MEMBERSHIP_REQUIRED','Choose an active company member');
 requireRule((await t.query('SELECT id FROM warehouses WHERE id=$1 AND org_id=$2 AND active',[p.warehouseId,a.org_id])).rows.length,'NOT_FOUND','Warehouse not found',404);
 const old=(await t.query('SELECT * FROM warehouse_grants WHERE user_id=$1 AND warehouse_id=$2 FOR UPDATE',[p.userId,p.warehouseId])).rows[0];
 version(old||{version:0},p.expectedVersion);
 await t.query(`INSERT INTO warehouse_grants(user_id,org_id,warehouse_id,active) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,warehouse_id) DO UPDATE SET active=$4,version=warehouse_grants.version+1`,[p.userId,a.org_id,p.warehouseId,p.active]);
 await event(t,a,p.warehouseId,'access.warehouse_changed',{userId:p.userId,previous:old||null,active:p.active,reason:p.reason});
 return (await t.query('SELECT * FROM warehouse_grants WHERE user_id=$1 AND warehouse_id=$2',[p.userId,p.warehouseId])).rows[0];
}
export async function provisionStaff(t:DB,a:Actor,payload:unknown){
 authorize(a,'manage_access');const p=schemas.staffProvision.parse(payload);await companyLock(t,a);
 if(p.warehouseId){
  const wh=(await t.query('SELECT id FROM warehouses WHERE id=$1 AND org_id=$2 AND active',[p.warehouseId,a.org_id])).rows[0];
  requireRule(wh,'NOT_FOUND','Warehouse not found',404);
 }
 let user=(await t.query('SELECT * FROM users WHERE lower(email)=lower($1)',[p.email])).rows[0];
 const isNew=!user;
 const passwordHash=p.password?await bcrypt.hash(p.password,10):null;
 if(!user){
  const id=uuid();
  await t.query('INSERT INTO users(id,org_id,email,name,role,active,password_hash) VALUES($1,$2,$3,$4,$5,true,$6)',[id,a.org_id,p.email.toLowerCase(),p.name,p.role,passwordHash]);
  user=(await t.query('SELECT * FROM users WHERE id=$1',[id])).rows[0];
  await event(t,a,user.id,'access.user_provisioned',{email:p.email,name:p.name,role:p.role,reason:p.reason});
 }else{
  if(passwordHash)await t.query('UPDATE users SET name=$1,active=true,password_hash=$2 WHERE id=$3',[p.name,passwordHash,user.id]);
  else await t.query('UPDATE users SET name=$1,active=true WHERE id=$2',[p.name,user.id]);
 }
 const oldMembership=(await t.query('SELECT * FROM company_memberships WHERE org_id=$1 AND user_id=$2 FOR UPDATE',[a.org_id,user.id])).rows[0];
 await t.query(`INSERT INTO company_memberships(user_id,org_id,role,active) VALUES($1,$2,$3,true) ON CONFLICT(user_id,org_id) DO UPDATE SET role=$3,active=true,version=company_memberships.version+1`,[user.id,a.org_id,p.role]);
 await event(t,a,user.id,'access.membership_changed',{previous:oldMembership||null,role:p.role,active:true,reason:p.reason});
 if(p.warehouseId){
  const oldGrant=(await t.query('SELECT * FROM warehouse_grants WHERE user_id=$1 AND warehouse_id=$2 FOR UPDATE',[user.id,p.warehouseId])).rows[0];
  await t.query(`INSERT INTO warehouse_grants(user_id,org_id,warehouse_id,active) VALUES($1,$2,$3,true) ON CONFLICT(user_id,warehouse_id) DO UPDATE SET active=true,version=warehouse_grants.version+1`,[user.id,a.org_id,p.warehouseId]);
  await event(t,a,p.warehouseId,'access.warehouse_changed',{userId:user.id,previous:oldGrant||null,active:true,reason:p.reason});
 }
 return {
  user:(await t.query('SELECT id,email,name,active,org_id FROM users WHERE id=$1',[user.id])).rows[0],
  membership:(await t.query('SELECT * FROM company_memberships WHERE org_id=$1 AND user_id=$2',[a.org_id,user.id])).rows[0],
  grant:p.warehouseId?(await t.query('SELECT * FROM warehouse_grants WHERE user_id=$1 AND warehouse_id=$2',[user.id,p.warehouseId])).rows[0]:null,
  isNew,
 };
}

