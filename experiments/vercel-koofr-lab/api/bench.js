import {authorize} from '../lib/oidc.mjs';
import {validateInput,operate} from '../lib/storage.mjs';
import {randomUUID} from 'node:crypto';
const expires=Date.parse('2026-10-18T03:00:00Z');
async function body(request){const reader=request.body?.getReader();if(!reader)throw Error();let text='',bytes=0;const decoder=new TextDecoder();while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>4096){await reader.cancel();throw Error();}text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode());}
function json(value,status){return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}});}
export async function GET(){return json({kind:'isolated-koofr-benchmark',active:Date.now()<expires,region:process.env.VERCEL_REGION??'local'},200);}
export async function POST(request){
 const requestId=randomUUID(),started=performance.now();let auth;
 if(Date.now()>=expires)return json({code:'EXPERIMENT_EXPIRED'},410);
 try{auth=await authorize(request.headers.get('authorization')?.replace(/^Bearer /,''));}catch{return json({code:'UNAUTHORIZED'},401);}
 let input;try{input=await body(request);validateInput(input,auth.runId);}catch{return json({code:'INVALID_INPUT'},400);}
 try{
  const result=await operate(input);const response={...result,requestId,region:process.env.VERCEL_REGION??'local',authAndParseMs:performance.now()-started-result.ms};
  // Metadata only: never log requests, credentials, lock tokens, body or provider XML.
  console.log(JSON.stringify({kind:'koofr-preview',requestId,region:response.region,mode:input.mode,transport:input.transport,status:result.status,code:result.code,ms:result.ms}));
  return json(response,result.status);
 }catch{return json({code:'REQUEST_FAILED',requestId},503);}
 finally{input=undefined;}
}
export default {fetch(request){if(request.method==='GET')return GET();if(request.method==='POST')return POST(request);return json({code:'METHOD_NOT_ALLOWED'},405);}};
