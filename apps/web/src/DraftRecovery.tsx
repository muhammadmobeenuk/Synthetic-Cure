import {useEffect,useState} from 'react';
import {scopedTaskDrafts} from './api';
export function DraftRecovery({scope}:{scope:string}){
 const [records,setRecords]=useState<any[]>([]),[error,setError]=useState('');
 async function load(){try{setRecords(await scopedTaskDrafts(scope));setError('');}catch{setError('Device drafts could not be read. Retry without clearing device storage.');}}
 useEffect(()=>{void load();},[scope]);
 if(!records.length&&!error)return null;
 return <section className="panel entity-card company-setup"><h2>Preserved task forms · on this device</h2><p>These captures are not a sync queue and may include work completed elsewhere. Resume the task in this warehouse and compare against current records. A new confirmation still goes through server validation.</p>{error&&<p role="alert">{error}</p>}{records.map(r=><details key={String(r.key)}><summary>{r.value.title} · {r.value.savedAt}</summary><pre className="draft-values">{JSON.stringify(r.value.values,null,2)}</pre><small>Original operation ID: {r.value.operation}</small></details>)}<button className="btn secondary" onClick={load}>Refresh device captures</button></section>;
}
