import { openDB } from "idb";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any,
  ) {
    super(message);
  }
}
let csrf = "";
let requestContext:Record<string,string>={};
export function setApiContext(user?:{org_id:string;warehouse_id?:string|null}|null){requestContext=user?{"X-Company-Context":user.org_id,"X-Warehouse-Context":user.warehouse_id||"none"}:{};}
export function setCsrf(value: string) {
  csrf = value;
}
export async function api(
  url: string,
  body?: any,
  method = body ? "POST" : "GET",
) {
  let response;
  try {
    response = await fetch("/api/v1" + url, {
      method,
      headers:
        body instanceof FormData
          ? { "X-CSRF-Token": csrf,...requestContext }
          : { "Content-Type": "application/json", "X-CSRF-Token": csrf,...requestContext },
      body: body
        ? body instanceof FormData
          ? body
          : JSON.stringify(body)
        : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(
      0,
      "OFFLINE",
      "Server connection unavailable. Your form remains on this device.",
    );
  }
  const content = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      content.error?.code || "ERROR",
      content.error?.message || "Request failed",
      content.error?.details,
    );
  return content;
}
export function newOperation(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20)
  );
}
const drafts = () =>
  openDB("jadesun-local-drafts", 1, {
    upgrade(db) {
      db.createObjectStore("drafts");
    },
  });
export async function saveDraft(user: string, key: string, value: any) {
  const db = await drafts();
  await db.put(
    "drafts",
    { ...value, savedAt: new Date().toISOString() },
    user + ":" + key,
  );
}
export async function getDraft(user: string, key: string, legacyUser?:string|string[]) {
  const db=await drafts();
  const current=await db.get("drafts", user + ":" + key);
  if(current)return current;
  for(const old of Array.isArray(legacyUser)?legacyUser:legacyUser?[legacyUser]:[]){const value=await db.get("drafts",old+":"+key);if(value)return value;}
  return undefined;
}
export async function draftCount(scope:string) {
  return (await (await drafts()).getAllKeys("drafts")).filter(k=>String(k).startsWith(scope+":")).length;
}
export async function deleteDraft(user: string, key: string, legacyUser?:string|string[]) {
  const db=await drafts();
  await db.delete("drafts", user + ":" + key);
  for(const old of Array.isArray(legacyUser)?legacyUser:legacyUser?[legacyUser]:[])await db.delete("drafts",old+":"+key);
}
export async function clearDrafts(user: string) {
  const db = await drafts();
  for (const key of await db.getAllKeys("drafts"))
    if (String(key).startsWith(user + ":")) await db.delete("drafts", key);
}

export async function identityDraftKeys(user:{id:string;home_org_id?:string;org_id:string}) {
 const db=await drafts(),keys=await db.getAllKeys("drafts"),legacy=[user.id+":",(user.home_org_id||user.org_id)+":"+user.id+":"];
 const owned=[];
 for(const key of keys){const value=await db.get("drafts",key);if(value?._ownerUserId===user.id||legacy.some(p=>String(key).startsWith(p)))owned.push(key);}
 return owned;
}
export async function clearIdentityDrafts(user:{id:string;home_org_id?:string;org_id:string}) {
 const db=await drafts();for(const key of await identityDraftKeys(user))await db.delete("drafts",key);
}

export async function scopedTaskDrafts(scope:string){
 const db=await drafts(),records=[];
 for(const key of await db.getAllKeys('drafts'))if(String(key).startsWith(scope+':pending-task:'))records.push({key,value:await db.get('drafts',key)});
 return records;
}
