import {saveDraft,deleteDraft} from "./api";
import {draftScope} from "./draft-scope";
const captures=new Map<symbol,()=>Promise<void>>();
export function registerPendingCapture(capture:()=>Promise<void>){
 const id=Symbol();captures.set(id,capture);return ()=>{captures.delete(id);};
}
export async function preservePendingWork(){for(const capture of captures.values())await capture();}

// Capture first: a form that is still open may not yet have an IndexedDB draft.
// Never discard anything unless both the user and the server confirm sign-out.
export async function signOutSafely(actions:{capture:()=>Promise<void>; count:()=>Promise<number>; confirm:(count:number)=>boolean; signOut:()=>Promise<void>; clear:()=>Promise<void>}){
 await actions.capture();
 const count=await actions.count();
 if(count&&!actions.confirm(count))return false;
 await actions.signOut();
 await actions.clear();
 return true;
}

// Configuration/access drafts contain only fields the active staff member is editing.
// They are reviewable captures, not queued authoritative operations.
export async function saveFormCapture(user:{id:string;org_id:string;warehouse_id?:string|null},key:string,title:string,values:any,operation:string){
 await saveDraft(draftScope(user),'pending-task:'+key,{title,values,operation,_ownerUserId:user.id});
}
export async function clearFormCapture(user:{id:string;org_id:string;warehouse_id?:string|null},key:string){
 await deleteDraft(draftScope(user),'pending-task:'+key);
}
