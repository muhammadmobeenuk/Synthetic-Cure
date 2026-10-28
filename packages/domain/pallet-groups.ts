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
// A planning snapshot, not a load approval. One physical box is counted once even
// when its shipment contains several product lines.
export async function palletGroupReconciliation(t:DB,a:Actor,id:string,cursor?:unknown){
 authorize(a,'dispatch');requireRule(a.warehouse_id,'WAREHOUSE_ACCESS','Select an assigned warehouse',403);
 const group=await owned(t,'pallet_groups',id,a);
 let after='';
 if(cursor!==undefined){
  requireRule(typeof cursor==='string'&&cursor.length>0&&cursor.length<=1024&&/^[A-Za-z0-9_-]+$/.test(cursor),'CURSOR','Invalid review cursor',400);
  let parsed:any;try{parsed=JSON.parse(Buffer.from(cursor as string,'base64url').toString('utf8'));}catch{requireRule(false,'CURSOR','Invalid review cursor',400);}
  requireRule(parsed&&parsed.groupId===id&&typeof parsed.after==='string'&&parsed.after.length>0&&parsed.after.length<=200&&Number.isSafeInteger(parsed.version),'CURSOR','Invalid review cursor',400);
  requireRule(parsed.version===group.version,'VERSION_CONFLICT','Pallet group changed. Restart the review.',409);
  after=parsed.after;
 }
 const boxes=(await t.query(`SELECT b.id,b.code,b.status,b.pallet_id,p.code pallet_code,p.manifest_revision,p.checked_revision
 FROM pallet_group_memberships m JOIN pallets p ON p.id=m.pallet_id AND p.org_id=m.org_id AND p.warehouse_id=m.warehouse_id
 JOIN boxes b ON b.pallet_id=p.id AND b.org_id=m.org_id AND b.warehouse_id=m.warehouse_id
 WHERE m.group_id=$1 AND m.org_id=$2 AND m.warehouse_id=$3 AND m.removed_at IS NULL AND b.id>$4
 ORDER BY b.id LIMIT 201`,[id,a.org_id,a.warehouse_id,after])).rows;
 const visible=boxes.slice(0,200), ids=visible.map(b=>b.id);
 const assignments=ids.length?(await t.query(`SELECT sl.box_id,s.id shipment_id,s.trip_id,tr.code trip_code,s.status shipment_status,
 o.code order_code,c.name customer_name,d.name destination_name,BOOL_AND(sl.loaded) loaded
 FROM shipment_lines sl JOIN shipments s ON s.id=sl.shipment_id AND s.org_id=sl.org_id AND s.warehouse_id=sl.warehouse_id
 JOIN orders o ON o.id=s.order_id AND o.org_id=s.org_id AND o.warehouse_id=s.warehouse_id
 JOIN customers c ON c.id=o.customer_id AND c.org_id=o.org_id
 JOIN destinations d ON d.id=s.destination_id AND d.org_id=s.org_id
 LEFT JOIN trips tr ON tr.id=s.trip_id AND tr.org_id=s.org_id AND tr.warehouse_id=s.warehouse_id
 WHERE sl.org_id=$1 AND sl.warehouse_id=$2 AND sl.box_id=ANY($3::text[])
 AND s.status IN ('ready','needs_recheck','dispatched','partial')
 GROUP BY sl.box_id,s.id,s.trip_id,tr.code,s.status,o.code,c.name,d.name ORDER BY sl.box_id,s.id`,[a.org_id,a.warehouse_id,ids])).rows:[];
 const nextCursor=boxes.length>200?Buffer.from(JSON.stringify({groupId:id,version:group.version,after:visible[visible.length-1].id})).toString('base64url'):null;
 return {groupId:group.id,groupVersion:group.version,tripId:group.trip_id,truncated:boxes.length>200,nextCursor,boxes:visible.map(b=>{
  const shipments=assignments.filter(s=>s.box_id===b.id);
  const state=shipments.length===0?'no_shipment':shipments.length>1?'multiple_shipments':!shipments[0].trip_id?'trip_unassigned':shipments[0].trip_id===group.trip_id?'same_trip':'different_trip';
  return {...b,state,shipments};
 })};
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

export async function loadPalletGroupWorkflow(t: DB, a: Actor, id: string, payload?: unknown) {
  authorize(a, 'dispatch');
  requireRule(a.warehouse_id, 'WAREHOUSE_ACCESS', 'Select an assigned warehouse', 403);
  const group = await owned(t, 'pallet_groups', id, a, true);
  const trip = await owned(t, 'trips', group.trip_id, a, true);
  requireRule(trip.status === 'planned', 'TRIP_STATE', 'Trip must be in planned status to load');

  const pallets = (
    await t.query(
      `SELECT p.* FROM pallet_group_memberships m
       JOIN pallets p ON p.id = m.pallet_id AND p.warehouse_id = m.warehouse_id
       WHERE m.group_id = $1 AND m.org_id = $2 AND m.warehouse_id = $3 AND m.removed_at IS NULL
       FOR UPDATE OF p`,
      [id, a.org_id, a.warehouse_id],
    )
  ).rows;
  requireRule(pallets.length > 0, 'EMPTY_GROUP', 'Pallet group contains no active pallets');

  let totalBoxesLoaded = 0;
  const shipmentIds = new Set<string>();
  for (const pallet of pallets) {
    requireRule(
      pallet.checked_revision !== null && pallet.checked_revision === pallet.manifest_revision,
      'MANIFEST_UNCHECKED',
      `Pallet manifest is unchecked or stale: ${pallet.code}`,
    );

    const boxes = (
      await t.query(
        'SELECT * FROM boxes WHERE pallet_id = $1 AND org_id = $2 AND warehouse_id = $3 FOR UPDATE',
        [pallet.id, a.org_id, a.warehouse_id],
      )
    ).rows;
    requireRule(boxes.length > 0, 'EMPTY_PALLET', `Pallet has no boxes: ${pallet.code}`);

    for (const box of boxes) {
      requireRule(box.status === 'confirmed', 'BOX_STATE', `Box must be confirmed: ${box.code}`);
      requireRule(box.condition === 'good', 'BOX_CONDITION', `Box condition must be good: ${box.code}`);

      const issues = (
        await t.query("SELECT id FROM issues WHERE box_id = $1 AND status = 'open'", [box.id])
      ).rows;
      requireRule(issues.length === 0, 'OPEN_ISSUE', `Box has open issues: ${box.code}`);

      const lines = (
        await t.query(
          `SELECT sl.*, s.trip_id, s.status shipment_status
           FROM shipment_lines sl
           JOIN shipments s ON s.id = sl.shipment_id AND s.org_id = sl.org_id AND s.warehouse_id = sl.warehouse_id
           WHERE sl.box_id = $1 AND sl.org_id = $2 AND sl.warehouse_id = $3`,
          [box.id, a.org_id, a.warehouse_id],
        )
      ).rows;
      requireRule(lines.length > 0, 'NO_SHIPMENT', `Box is not assigned to any shipment: ${box.code}`);

      for (const line of lines) {
        requireRule(
          line.trip_id === group.trip_id,
          'WRONG_TRIP',
          `Box is assigned to trip ${line.trip_id}, not group trip ${group.trip_id}`,
        );
        requireRule(
          line.shipment_status === 'ready' || line.shipment_status === 'needs_recheck',
          'SHIPMENT_STATE',
          'Shipment must be in ready status to load',
        );

        await t.query('UPDATE shipment_lines SET loaded = true WHERE id = $1', [line.id]);
        totalBoxesLoaded++;
        shipmentIds.add(line.shipment_id);
      }
    }
  }

  const pData = payload as any;
  for (const sId of shipmentIds) {
    await t.query(
      `UPDATE shipments SET
         recipient_type = COALESCE($1, recipient_type),
         recipient_name = COALESCE($2, recipient_name),
         recipient_signature = COALESCE($3, recipient_signature),
         version = version + 1
       WHERE id = $4`,
      [
        pData?.recipientType || null,
        pData?.recipientName || null,
        pData?.recipientSignature || null,
        sId,
      ],
    );
  }

  await event(t, a, id, 'pallet_group.loaded', {
    tripId: trip.id,
    palletsCount: pallets.length,
    boxesLoadedCount: totalBoxesLoaded,
    reason: pData?.reason,
  });

  return {
    groupId: id,
    tripId: trip.id,
    loaded: true,
    loadedBoxesCount: totalBoxesLoaded,
    palletsCount: pallets.length,
    boxesLoadedCount: totalBoxesLoaded,
  };
}

