import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signOutSafely} from '../apps/web/src/work-preservation.js';

function fixture(options:{drafts?:number;accept?:boolean;fail?:string}={}) {
 const events:string[]=[];
 const step=(name:string)=>{events.push(name);if(options.fail===name)throw new Error(name);};
 return {events,actions:{
  capture:async()=>{step('capture');},
  count:async()=>{step('count');return options.drafts??1;},
  confirm:()=>{step('confirm');return options.accept??true;},
  signOut:async()=>{step('signOut');},
  clear:async()=>{step('clear');},
 }};
}
test('open work is captured and confirmed before server sign-out and cleanup',async()=>{
 const f=fixture();assert.equal(await signOutSafely(f.actions),true);
 assert.deepEqual(f.events,['capture','count','confirm','signOut','clear']);
});
test('cancelled warning keeps session and drafts',async()=>{
 const f=fixture({accept:false});assert.equal(await signOutSafely(f.actions),false);
 assert.deepEqual(f.events,['capture','count','confirm']);
});
test('storage and server failures never discard drafts',async()=>{
 for(const fail of ['capture','count','signOut']){
  const f=fixture({fail});await assert.rejects(signOutSafely(f.actions));
  assert.equal(f.events.includes('clear'),false);
 }
});
test('no drafts skips confirmation but still waits for server',async()=>{
 const f=fixture({drafts:0});await signOutSafely(f.actions);
 assert.deepEqual(f.events,['capture','count','signOut','clear']);
});
