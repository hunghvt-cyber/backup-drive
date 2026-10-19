import {NoteStore} from '../../lib/store.mjs';
import {createDav} from '../../lib/storage.mjs';
export function backend(){
 let clock=0,tokenCounter=0;const files=new Map(),folders=new Set(),locks=new Map(),requests=[];
 function held(path){for(const [root,l] of locks){if(l.until<=clock){locks.delete(root);continue;}if(path===root||path.startsWith(root))return l;}return null;}
 async function wire(url,options,{fault,onInjected=()=>{}}={}){
  if(fault==='before-send'){onInjected({phase:fault,requestBodySubmitted:false,socketDestroyed:true});throw Error('NETWORK_OR_TIMEOUT');}
  const path=new URL(url).pathname,method=options.method,l=held(path);requests.push({path,method});let r={status:500,text:''};
  if(method==='MKCOL'){r.status=folders.has(path)?405:201;folders.add(path);}
  if(method==='GET')r=files.has(path)?{status:200,text:files.get(path)}:{status:404,text:''};
  if(method==='LOCK'){if(l)r.status=423;else{const token='<fake-lock-'+(++tokenCounter)+'>',seconds=Number(options.headers.Timeout.match(/Second-(\d+)/)[1]);locks.set(path,{token,until:clock+seconds*1000});r={status:200,token,text:'<d:timeout>Second-'+seconds+'</d:timeout>'};}}
  if(method==='UNLOCK'){if(l&&l.token===options.headers['Lock-Token']){locks.delete(path);r.status=204;}else r.status=409;}
  if(method==='PUT'){if(l&&options.headers.If!=='('+l.token+')')r.status=options.headers.If?412:423;else if(!l&&options.headers.If)r.status=412;else{files.set(path,options.body);r.status=201;}}
  if(fault==='after-response-headers'){onInjected({phase:fault,observedStatus:r.status,socketDestroyed:true});throw Error('NETWORK_OR_TIMEOUT');}
  return {...r,timing:{ttfbMs:0,reusedSocket:false}};
 }
 const makeDav=(input,opts={})=>createDav({...input,transport:'pooled'},{nativeRequest:wire,...opts});
 const makeStore=x=>new NoteStore(x,{makeDav,lease:x.testLease??60,beforePublish:x.testBeforePublish,wire:x.testWire??wire,now:x.testNow});
 return {makeStore,wire,makeDav,files,requests,wait:async ms=>{clock+=ms;},locks};
}
