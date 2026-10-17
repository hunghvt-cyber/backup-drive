import https from 'node:https';
import {createHash,randomUUID} from 'node:crypto';
const origin='https://app.koofr.net';
const agent=new https.Agent({keepAlive:true,maxSockets:2,maxFreeSockets:2,timeout:15000});
export const lockXml='<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>Homepage synthetic preview</D:owner></D:lockinfo>';
export const hash=s=>createHash('sha256').update(s).digest('hex');
const must=(x,code)=>{if(!x)throw Error(code);};
export const validToken=t=>typeof t==='string'&&/^<[^<>\r\n]{1,300}>$/.test(t);
export function validateInput(input,runId){
 must(input&&typeof input==='object','INVALID_INPUT');
 const {user,password,namespace,mode,transport,opId,baseRevision}=input;
 must(typeof user==='string'&&user.length>0&&user.length<300&&!/[:\r\n]/.test(user)&&typeof password==='string'&&password.length>0&&password.length<600&&!/[\r\n]/.test(password),'INVALID_CREDENTIAL_FORMAT');
 must(typeof namespace==='string'&&new RegExp('^Homepage-Notes-Vercel-Probe-'+runId+'-[a-f0-9-]{36}$').test(namespace),'PATH_FORBIDDEN');
 must(['seed','read','save','expiry','faults','restore','store100'].includes(mode)&&['fetch','pooled'].includes(transport),'INVALID_MODE');
 if(mode==='save')must(/^[a-f0-9-]{36}$/.test(opId)&&Number.isSafeInteger(baseRevision)&&baseRevision>=0,'INVALID_OPERATION');
}
export function nativeTransport(url,options,{fault,onInjected=()=>{},maxResponseBytes=32000}={}){
 return new Promise((resolve,reject)=>{
  const start=performance.now(),timing={},req=https.request(url,{method:options.method,headers:options.headers,agent,signal:AbortSignal.timeout(12000)},res=>{
   timing.ttfbMs=performance.now()-start;let text='',bytes=0;
   res.setEncoding('utf8');res.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>maxResponseBytes)res.destroy(Error('RESPONSE_TOO_LARGE'));else text+=chunk;});
   res.on('error',()=>reject(Error('NETWORK_OR_TIMEOUT')));res.on('end',()=>resolve({status:res.statusCode,text,token:res.headers['lock-token'],timeout:res.headers.timeout,timing:{...timing,reusedSocket:req.reusedSocket}}));
   if(fault==='after-response-headers'){onInjected({phase:fault,observedStatus:res.statusCode,socketDestroyed:true});res.destroy();req.destroy();reject(Error('NETWORK_OR_TIMEOUT'));}
  });
  req.on('socket',s=>{if(!s.connecting)return;s.once('lookup',()=>timing.dnsMs=performance.now()-start);s.once('connect',()=>timing.tcpMs=performance.now()-start);s.once('secureConnect',()=>timing.tlsMs=performance.now()-start);});
  req.on('error',()=>reject(Error('NETWORK_OR_TIMEOUT')));
  if(fault==='before-send'){onInjected({phase:fault,requestBodySubmitted:false,socketDestroyed:true});req.destroy();reject(Error('NETWORK_OR_TIMEOUT'));}else req.end(options.body);
 });
}
export function createDav(input,{fetcher=fetch,nativeRequest=nativeTransport,file='note.json'}={}){
 const member=file.match(/^note-(\d{3})-([a-f0-9-]{36})\.json$/);
 must(['note.json','backup.json','recovered.json','catalog.json','store-backup.json'].includes(file)||(member&&Number(member[1])<=127),'PATH_FORBIDDEN');
 const maxResponseBytes=file==='store-backup.json'?2000000:file==='catalog.json'?256000:32000;
 const auth='Basic '+Buffer.from(input.user+':'+input.password).toString('base64');
 const url=origin+'/dav/Koofr/'+input.namespace+'/'+file;const calls=[];
 async function call(label,method,body,headers={},folder=false){
  const start=performance.now(),row={label,method};
  try{
   const options={method,headers:{Authorization:auth,...(body===undefined?{}:{'Content-Type':method==='LOCK'?'application/xml; charset=utf-8':'application/json; charset=utf-8'}),...headers},...(body===undefined?{}:{body}),redirect:'error',signal:AbortSignal.timeout(12000)};
   const target=folder?url.slice(0,-file.length):url;let r;
   if(input.transport==='pooled')r=await nativeRequest(target,options,{label,maxResponseBytes});
   else {const s=await fetcher(target,options);const ttfbMs=performance.now()-start;const text=await s.text();must(Buffer.byteLength(text)<=maxResponseBytes,'RESPONSE_TOO_LARGE');r={status:s.status,text,token:s.headers.get('lock-token'),timing:{ttfbMs}};}
   row.status=r.status;row.timing=r.timing;return r;
  }catch(e){row.error='NETWORK_OR_TIMEOUT';throw Error('NETWORK_OR_TIMEOUT');}
  finally{row.ms=performance.now()-start;calls.push(row);}
 }
 return {call,calls};
}
function content(opId){return '# SYNTHETIC Homepage Notes\nTiếng Việt 日本語 😀\n- [x] Xong\n- [ ] Chờ\n'+opId+'\n'+'Synthetic text. '.repeat(120);}
function record(revision,opId,receipts=[]){const body=content(opId);return {schema:1,revision,body,bodyHash:hash(body),receipts:[...receipts,{opId,revision,bodyHash:hash(body)}].slice(-8)};}
export function parseRecord(text){let j;try{j=JSON.parse(text);}catch{throw Error('INVALID_STORED_RECORD');}must(j.schema===1&&Number.isSafeInteger(j.revision)&&j.revision>=0&&typeof j.body==='string'&&hash(j.body)===j.bodyHash&&Array.isArray(j.receipts)&&j.receipts.length<=8,'INVALID_STORED_RECORD');return j;}
export async function operate(input,{dav=createDav(input)}={}){
 const start=performance.now(),{call,calls}=dav,callStart=calls.length;let token,result,putAttempted=false,committed=false;
 try{
  if(input.mode==='seed'){
   // A unique folder must be successfully created before any unconditional fixture PUT.
   const folder=await call('new-namespace','MKCOL',undefined,{},true);must(folder.status===201,'NAMESPACE_NOT_CREATED');
   const payload=JSON.stringify(record(0,randomUUID()));const r=await call('seed-note','PUT',payload);must([200,201,204].includes(r.status),'SEED_FAILED');
   const read=await call('seed-verify','GET');must(read.status===200&&read.text===payload,'SEED_VERIFY_FAILED');result={status:200,code:'SEEDED',revision:0};
  }else if(input.mode==='read'){
   const read=await call('read-note','GET');must(read.status===200,'READ_FAILED');const j=parseRecord(read.text);result={status:200,code:'READ',revision:j.revision,bytes:Buffer.byteLength(read.text),bodyHash:j.bodyHash};
  }else{
   const lock=await call('lock','LOCK',lockXml,{Timeout:'Second-60',Depth:'0'});
   if(lock.status===423)return {status:423,code:'BUSY',committed:false,calls:calls.slice(callStart),ms:performance.now()-start};
   must([200,201].includes(lock.status)&&validToken(lock.token),'LOCK_FAILED');token=lock.token;
   const read=await call('base-under-lock','GET');must(read.status===200,'BASE_READ_FAILED');const current=parseRecord(read.text);
   const receipt=current.receipts.find(r=>r.opId===input.opId);
   if(receipt){must(receipt.bodyHash===hash(content(input.opId)),'OP_ID_REUSE');result={status:200,code:'REPLAY',revision:receipt.revision,currentRevision:current.revision};committed=true;}
   else if(current.revision!==input.baseRevision)result={status:409,code:'CONFLICT',revision:current.revision};
   else{
    const next=record(current.revision+1,input.opId,current.receipts),payload=JSON.stringify(next);putAttempted=true;
    let put;try{put=await call('locked-put','PUT',payload,{If:'('+token+')'});}catch{
     // One read under the existing lock can reconcile an ambiguous PUT. Never retry it blindly.
     const check=await call('reconcile-ambiguous-put','GET');
     if(check.status===200&&check.text===payload){committed=true;result={status:200,code:'RECONCILED',revision:next.revision};}
     else throw Error('WRITE_OUTCOME_UNKNOWN');
    }
    if(put){must([200,201,204].includes(put.status),'PUT_REJECTED');const verified=await call('readback','GET');must(verified.status===200&&verified.text===payload,'WRITE_OUTCOME_UNKNOWN');committed=true;result={status:200,code:'VERIFIED',revision:next.revision};}
   }
  }
 }catch(e){result={status:503,code:/^[A-Z_]{1,60}$/.test(e.message)?e.message:'REQUEST_FAILED',uncertain:putAttempted&&!committed};}
 finally{
  if(token){try{const r=await call('unlock','UNLOCK',undefined,{'Lock-Token':token});if(![200,204].includes(r.status))throw Error();token=undefined;}catch{if(result)result.cleanupWarning='LOCK_RELEASE_UNVERIFIED';}}
 }
 return {...result,committed,possibleOutstandingLock:!!token,calls:calls.slice(callStart),ms:performance.now()-start};
}
