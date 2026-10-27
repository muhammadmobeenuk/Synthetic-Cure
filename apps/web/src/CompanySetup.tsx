import type {Identity} from "./draft-scope";
import {registerPendingCapture,saveFormCapture,clearFormCapture} from "./work-preservation";
import {useState,useEffect} from 'react';
import {api,newOperation,ApiError} from './api';
const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
type Config=Record<string,any>;
export function CompanySetup({value,canConfigure,onSaved,actor}:{value:Config;canConfigure:boolean;onSaved:()=>Promise<void>;actor:Identity}) {
  const [step,setStep]=useState<'identity'|'locale'|'schedule'|null>(null);
  const [draft,setDraft]=useState<Config>({}), [operation,setOperation]=useState(''), [expected,setExpected]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[saved,setSaved]=useState('');
  useEffect(()=>step?registerPendingCapture(()=>saveFormCapture(actor,'company:'+step,'Company setup · '+step,{...draft,expectedVersion:expected},operation)):undefined,[step,draft,expected,operation,actor.id,actor.org_id,actor.warehouse_id]);
  function edit(section:typeof step) {
    setStep(section); setExpected(value.version); setOperation(newOperation()); setError(''); setConflict(false); setSaved('');
    setDraft({displayName:value.display_name,operatingProfile:value.operating_profile||'',timezone:value.timezone||'',language:value.language||'',dateFormat:value.date_format||'',preparationWeekdays:value.preparation_weekdays||[],reason:''});
  }
  const field=(key:string,v:any)=>{setDraft({...draft,[key]:v}); if(error && !conflict)setError('');};
  const reviewed=['identity','locale','schedule'].filter(s=>value[s+'_reviewed']).length;
  return <section className="panel entity-card company-setup">
    <div className="section-head"><div><h2>Company setup</h2><p>Saved progress · {reviewed} of 3 foundational steps reviewed · v{value.version}</p></div></div>
    <p>Configure this company without changing source code. These settings do not enable specialist or third-party ownership workflows.</p>
    <ol className="setup-steps">{(['identity','locale','schedule'] as const).map((s,i)=><li key={s}><div><strong>{i+1}. {s==='identity'?'Company identity':s==='locale'?'Timezone & display':'Preparation schedule'}</strong><small>{value[s+'_reviewed']?'Reviewed':'Review required'} · {s==='identity'?value.display_name:s==='locale'?(value.timezone||'Timezone unconfirmed'):(value.preparation_weekdays?.map((d:number)=>days[d]).join(', ')||'Ad-hoc only · no recurring days')}</small></div>{canConfigure&&<button className="btn secondary" onClick={()=>edit(s)} disabled={busy||step!==null}>Review {s==='identity'?'identity':s==='locale'?'locale':'schedule'}</button>}</li>)}</ol>
    {step&&<form className="setup-form" onSubmit={async e=>{
      e.preventDefault(); setBusy(true); setError(''); setSaved('');
      const payload:Config={clientOperationId:operation,expectedVersion:expected,section:step,reason:draft.reason};
      if(step==='identity')Object.assign(payload,{displayName:draft.displayName,operatingProfile:draft.operatingProfile||null});
      if(step==='locale')Object.assign(payload,{timezone:draft.timezone,language:draft.language,dateFormat:draft.dateFormat});
      if(step==='schedule')payload.preparationWeekdays=draft.preparationWeekdays;
      try {await api('/company-configuration',payload); await clearFormCapture(actor,'company:'+step).catch(()=>{}); await onSaved();setStep(null);setSaved('Configuration saved · server confirmed');}
      catch(e){setError(e instanceof Error?e.message:'Configuration could not be saved');if(e instanceof ApiError&&e.status===409){setConflict(true);await onSaved();}}
      finally{setBusy(false);}
    }} aria-label={'Review company '+step}>
      <h3>{step==='identity'?'Company identity':step==='locale'?'Timezone & display':'Preparation schedule'}</h3>
      {step==='identity'&&<>
        <label>Company display name<input required maxLength={200} value={draft.displayName} onChange={e=>field('displayName',e.target.value)}/></label>
        <label>Intended operating profile<select value={draft.operatingProfile} onChange={e=>field('operatingProfile',e.target.value)}><option value="">Unconfirmed</option><option value="general">General goods</option><option value="wholesale">Wholesale distribution</option><option value="food">Food & produce</option><option value="printed">Printed/customised products</option><option value="3pl">Third-party fulfilment · ownership module unavailable</option></select></label>
      </>}
      {step==='locale'&&<>
        <label>Business timezone · IANA identifier<input required placeholder="e.g. Europe/London" value={draft.timezone} onChange={e=>field('timezone',e.target.value)}/></label>
        <label>Preferred language<select required value={draft.language} onChange={e=>field('language',e.target.value)}><option value="">Choose language</option><option value="en">English</option><option value="zh">Chinese · source names retained; interface translation pending</option></select></label>
        <label>Date format<select required value={draft.dateFormat} onChange={e=>field('dateFormat',e.target.value)}><option value="">Choose date format</option><option value="day-first">Day / month / year</option><option value="iso">Year-month-day</option></select></label>
        <p>Existing date-only business records keep their original dates. Language preference is recorded; full interface translation is not yet implemented.</p>
      </>}
      {step==='schedule'&&<fieldset><legend>Suggested preparation days</legend><p>Leave all unchecked for ad-hoc preparation. Suggestions never repeat orders or assign a delivery date.</p><div className="weekday-options">{days.map((d,i)=><label key={d}><input type="checkbox" checked={draft.preparationWeekdays.includes(i)} onChange={e=>field('preparationWeekdays',e.target.checked?[...draft.preparationWeekdays,i].sort():draft.preparationWeekdays.filter((x:number)=>x!==i))}/>{d}</label>)}</div></fieldset>}
      <label>Source / reason for this change<input required minLength={3} maxLength={1000} value={draft.reason} onChange={e=>field('reason',e.target.value)} aria-describedby={error?'configuration-error':undefined}/></label>
      {error&&<div className="notice error" id="configuration-error" role="alert"><span>{error}{conflict&&' Your entries are preserved. Compare with current settings above before retrying.'}</span></div>}
      {conflict&&<button type="button" className="btn secondary" onClick={()=>{setExpected(value.version);setOperation(newOperation());setConflict(false);setError('');}}>I reviewed current v{value.version} · keep my draft</button>}
      <div className="setup-actions"><button type="button" className="btn secondary" disabled={busy} onClick={()=>setStep(null)}>Cancel</button><button className="btn primary" disabled={busy||conflict}>{busy?'Saving…':'Save '+step}</button></div>
    </form>}
    {saved&&<p role="status" className="notice success">{saved}</p>}
    <div className="notice info"><span><strong>Operational onboarding remains incomplete.</strong> Staff identity provisioning, customer/supplier imports and opening reconciliation, label preferences and final readiness approval still need validated workflows. Completing these three steps does not approve live operation.</span></div>
  </section>;
}
