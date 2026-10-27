import type {Identity} from "./draft-scope";
import {registerPendingCapture,saveFormCapture,clearFormCapture} from "./work-preservation";
import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,newOperation,ApiError} from './api';
type Row=Record<string,any>;
export function ContextPicker({session,onSwitch}:{session:Row;onSwitch:(companyId:string,warehouseId?:string)=>Promise<void>}){
 const [company,setCompany]=useState(session.user?.org_id||session.companies?.[0]?.org_id||''),[warehouse,setWarehouse]=useState(session.user?.warehouse_id||'');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const sameCompany=company===session.user?.org_id;
 useEffect(()=>{setCompany(session.user?.org_id||session.companies?.[0]?.org_id||'');setWarehouse(session.user?.warehouse_id||'');},[session.user?.org_id,session.user?.warehouse_id]);
 return <section className="panel entity-card company-setup"><h2>Company & warehouse</h2><p>Only assigned workspaces can be opened. Saved drafts remain with their original company, warehouse and staff identity.</p>
 <form className="context-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await onSwitch(company,sameCompany&&warehouse?warehouse:undefined);}catch(e){setError(e instanceof Error?e.message:'Workspace could not be opened');}finally{setBusy(false);}}}>
 <label>Company<select required value={company} onChange={e=>{setCompany(e.target.value);setWarehouse('');}}>{!(session.companies||[]).length&&<option value="">No active memberships</option>}{(session.companies||[]).map((c:Row)=><option key={c.org_id} value={c.org_id}>{c.name} · {c.role}</option>)}</select><small className="context-caption" aria-hidden="true">{session.companies?.find((c:Row)=>c.org_id===company)?.name}</small></label>
 {sameCompany&&<label>Assigned warehouse<select value={warehouse} onChange={e=>setWarehouse(e.target.value)}><option value="">Choose first assigned warehouse</option>{(session.warehouses||[]).map((w:Row)=><option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select><small className="context-caption" aria-hidden="true">{session.warehouses?.find((w:Row)=>w.id===warehouse)?.name || 'The server will choose an assigned warehouse.'}</small></label>}
 {!sameCompany&&<p>The server will select an assigned warehouse in that company. If none is assigned, operational access remains blocked.</p>}
 {sameCompany&&!(session.warehouses||[]).length&&<p role="status">No warehouse assigned. An administrator can grant access below.</p>}
 {error&&<p className="notice error" role="alert">{error}</p>}
 <button className="btn primary" disabled={busy||!company}>{busy?'Opening…':'Open selected workspace'}</button>
 </form></section>;
}
const roles=['administrator','supervisor','operator','dispatcher','driver','reviewer'];
export function AccessControl({companyId,onChanged,actor}:{companyId:string;onChanged:()=>Promise<void>;actor:Identity}){
 const directory=useQuery({queryKey:['access-directory',companyId],queryFn:()=>api('/access/directory'),retry:false});
 const [mode,setMode]=useState(''),[draft,setDraft]=useState<Row>({}),[op,setOp]=useState(''),[expected,setExpected]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
 useEffect(()=>mode?registerPendingCapture(()=>saveFormCapture(actor,'access:'+mode,'Access form · '+mode,{...draft,expectedVersion:expected},op)):undefined,[mode,draft,expected,op,actor.id,actor.org_id,actor.warehouse_id]);
 const d=directory.data||{}, members:Row[]=d.members||[],warehouses:Row[]=d.warehouses||[],grants:Row[]=d.grants||[];
 function open(kind:string){setMode(kind);setDraft({role:'operator',active:true,email:'',userId:'',warehouseId:'',name:'',code:'',address:'',reason:''});setOp(newOperation());setExpected(0);setError('');setSaved('');}
 const field=(key:string,value:any)=>setDraft({...draft,[key]:value});
 return <section className="panel entity-card company-setup"><h2>Staff & warehouse access</h2><p>Company administrator controls. A company membership grants no additional warehouse automatically. Existing staff identities are required; invitations and password provisioning are not part of this screen.</p>
 {directory.isPending&&<p role="status">Loading authorized access records…</p>}
 {directory.isError&&<><p role="alert">Access records could not be loaded.</p><button className="btn secondary" onClick={()=>directory.refetch()}>Retry access records</button></>}
 {directory.data&&<>
 <div className="card-actions">{[['warehouse','Create warehouse'],['review','Review warehouse identity'],['membership','Add / update membership'],['grant','Assign / revoke warehouse']].map(([kind,title])=><button key={kind} className="btn secondary" disabled={busy||!!mode} onClick={()=>open(kind)}>{title}</button>)}</div>
 <div className="access-summary">{warehouses.map(w=><div key={w.id}><strong>{w.code} · {w.name}</strong><small>{w.identity_confirmed?'Identity reviewed':'Identity unconfirmed'} · {grants.filter(g=>g.warehouse_id===w.id&&g.active&&members.some(m=>m.user_id===g.user_id&&m.active&&m.identity_active)).length} active grants</small></div>)}{members.map(m=><div key={m.user_id}><strong>{m.name}</strong><small>{m.email} · {m.role} · {m.active&&m.identity_active?'Active':'Inactive'} · v{m.version}</small></div>)}</div>
 </>}
 {mode&&<form className="setup-form" aria-label="Edit company access" onSubmit={async e=>{
 e.preventDefault();setBusy(true);setError('');const base={clientOperationId:op,reason:draft.reason};
 try{
 if(mode==='warehouse')await api('/warehouses',{...base,code:draft.code,name:draft.name,address:draft.address||null});
 if(mode==='review')await api('/warehouses/'+draft.warehouseId+'/review',{...base,expectedVersion:expected,name:draft.name,address:draft.address||null});
 if(mode==='membership')await api('/access/memberships',{...base,email:draft.email,expectedVersion:expected,role:draft.role,active:draft.active});
 if(mode==='grant')await api('/access/warehouse-grants',{...base,userId:draft.userId,warehouseId:draft.warehouseId,expectedVersion:expected,active:draft.active});
 await clearFormCapture(actor,'access:'+mode).catch(()=>{});await directory.refetch();await onChanged();setMode('');setSaved('Access change saved · server confirmed');
 }catch(e){setError((e instanceof Error?e.message:'Access change failed')+(e instanceof ApiError&&e.status===409?' Your entries remain. Cancel and reopen after reviewing the current record.':''));if(e instanceof ApiError&&e.status===409)await directory.refetch();}
 finally{setBusy(false);}
 }}>
 <h3>{mode==='warehouse'?'Create a warehouse':mode==='review'?'Review actual warehouse identity':mode==='membership'?'Company membership':'Warehouse access grant'}</h3>
 {mode==='warehouse'&&<label>Warehouse code<input required maxLength={80} value={draft.code} onChange={e=>field('code',e.target.value)}/></label>}
 {(mode==='review'||mode==='grant')&&<label>Warehouse<select required value={draft.warehouseId} onChange={e=>{const w=warehouses.find(w=>w.id===e.target.value);setDraft({...draft,warehouseId:e.target.value,...(mode==='grant'?{active:grants.find(g=>g.user_id===draft.userId&&g.warehouse_id===e.target.value)?.active??true}:{}),...(mode==='review'?{name:w?.identity_confirmed?w.name:'',address:w?.address||''}:{})});setExpected(mode==='review'?(w?.version||0):(grants.find(g=>g.user_id===draft.userId&&g.warehouse_id===e.target.value)?.version||0));setOp(newOperation());}}><option value="">Choose warehouse</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>}
 {(mode==='warehouse'||mode==='review')&&<><label>Verified warehouse name<input required maxLength={200} value={draft.name} onChange={e=>field('name',e.target.value)}/></label><label>Address · leave blank if unknown<textarea maxLength={1000} value={draft.address} onChange={e=>field('address',e.target.value)}/></label><p>No dimensions, storage restrictions or capacity are inferred from this identity.</p></>}
 {mode==='membership'&&<><label>Existing staff email<input required type="email" value={draft.email} onChange={e=>{const member=members.find(m=>m.email.toLowerCase()===e.target.value.toLowerCase());setDraft({...draft,email:e.target.value,...(member?{role:roles.includes(member.role)?member.role:'',active:member.active}:{})});setExpected(member?.version||0);setOp(newOperation());}}/></label><label>Company role<select required value={draft.role} onChange={e=>field('role',e.target.value)}><option value="">Choose approved company role</option>{roles.map(r=><option key={r}>{r}</option>)}</select></label></>}
 {mode==='grant'&&<label>Company member<select required value={draft.userId} onChange={e=>{setDraft({...draft,userId:e.target.value,active:grants.find(g=>g.user_id===e.target.value&&g.warehouse_id===draft.warehouseId)?.active??true});setExpected(grants.find(g=>g.user_id===e.target.value&&g.warehouse_id===draft.warehouseId)?.version||0);setOp(newOperation());}}><option value="">Choose active member</option>{members.filter(m=>m.active&&m.identity_active).map(m=><option key={m.user_id} value={m.user_id}>{m.name} · {m.email}</option>)}</select></label>}
 {(mode==='membership'||mode==='grant')&&<label className="checkbox-field"><input type="checkbox" checked={draft.active} onChange={e=>field('active',e.target.checked)}/>Access active · uncheck to revoke</label>}
 <label>Reason / source<input required minLength={3} maxLength={1000} value={draft.reason} onChange={e=>field('reason',e.target.value)}/></label>
 {mode!=='warehouse'&&<small>Editing version {expected} · 0 means a new relationship.</small>}
 {error&&<p className="notice error" role="alert">{error}</p>}
 <div className="setup-actions"><button type="button" className="btn secondary" disabled={busy} onClick={()=>setMode('')}>Cancel</button><button className="btn primary" disabled={busy}>{busy?'Saving…':'Save access change'}</button></div>
 </form>}
 {saved&&<p className="notice success" role="status">{saved}</p>}
 </section>;
}
