import {saveDraft,deleteDraft} from "./api";
import {draftScope} from "./draft-scope";
const captures=new Map<symbol,()=>Promise<void>>();
export function registerPendingCapture(capture:()=>Promise<void>){
 const id=Symbol();captures.set(id,capture);return ()=>{captures.delete(id);};
}
export async function preservePendingWork(){for(const capture of captures.values())await capture();}

// Configuration/access drafts contain only fields the active staff member is editing.
// They are reviewable captures, not queued authoritative operations.
export async function saveFormCapture(user:{id:string;org_id:string;warehouse_id?:string|null},key:string,title:string,values:any,operation:string){
 await saveDraft(draftScope(user),'pending-task:'+key,{title,values,operation,_ownerUserId:user.id});
}
export async function clearFormCapture(user:{id:string;org_id:string;warehouse_id?:string|null},key:string){
 await deleteDraft(draftScope(user),'pending-task:'+key);
}
