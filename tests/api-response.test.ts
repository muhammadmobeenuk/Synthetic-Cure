import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api,ApiError} from '../apps/web/src/api.js';

async function withResponse(response:Response|Error,run:()=>Promise<void>){
 const original=globalThis.fetch;
 globalThis.fetch=(async()=>{if(response instanceof Error)throw response;return response;}) as typeof fetch;
 try{await run();}finally{globalThis.fetch=original;}
}
test('API preserves a confirmed JSON response',async()=>{
 await withResponse(new Response(JSON.stringify({id:'order-1'}),{status:200}),async()=>assert.deepEqual(await api('/orders',{clientOperationId:'op'}),{id:'order-1'}));
});
test('API preserves structured validation and conflict responses',async()=>{
 for(const status of [422,409])await withResponse(new Response(JSON.stringify({error:{code:'TEST',message:'Review',details:{version:2}}}),{status}),async()=>{
  await assert.rejects(api('/orders',{}),(e:any)=>e instanceof ApiError&&e.status===status&&e.code==='TEST'&&e.details.version===2);
 });
});
test('malformed or empty server responses remain uncertain and hide upstream content',async()=>{
 for(const [status,body] of [[200,'<html>private proxy message</html>'],[400,'<html>bad request</html>'],[502,'gateway failed'],[200,''],[400,'{"unexpected":"failure"}']] as const){
  await withResponse(new Response(body,{status}),async()=>await assert.rejects(api('/orders',{clientOperationId:'op'}),(e:any)=>e instanceof ApiError&&e.status===0&&e.code==='RESPONSE_UNCONFIRMED'&&(!body||!e.message.includes(body))&&e.message.includes('retry')));
 }
});
test('network interruption reports an unconfirmed outcome',async()=>{
 await withResponse(new Error('network'),async()=>await assert.rejects(api('/orders',{}),(e:any)=>e instanceof ApiError&&e.code==='OFFLINE'&&e.message.includes('unconfirmed')));
});
