import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {authorize,audience} from '../lib/oidc.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'fake',alg:'RS256',use:'sig'};
const now=1792209000,repo='hunghvt-cyber/my-backup-gdrive-koofr',ref='refs/heads/experiment/homepage-koofr-webdav-20261017';
const claims={iss:'https://token.actions.githubusercontent.com',aud:audience,sub:'repo:'+repo+':ref:'+ref,repository:repo,repository_id:'1191594464',ref,event_name:'push',workflow_ref:repo+'/.github/workflows/koofr-vercel-bench.yml@'+ref,iat:now-10,exp:now+290,run_id:'123'};
function token(patch={},header={}){const parts=[Buffer.from(JSON.stringify({alg:'RS256',kid:'fake',...header})).toString('base64url'),Buffer.from(JSON.stringify({...claims,...patch})).toString('base64url')];return parts.join('.')+'.'+sign('RSA-SHA256',Buffer.from(parts.join('.')),privateKey).toString('base64url');}
const options={getKeys:async()=>[jwk],now};
test('only correctly signed repository, workflow, branch and audience can call preview',async()=>{assert.deepEqual(await authorize(token(),options),{runId:'123'});});
test('wrong claims, expiry, algorithm, signature and remote JWKS injection fail closed',async()=>{
 for(const patch of [{aud:'other'},{repository:'other/repo'},{repository_id:'5'},{ref:'refs/heads/main'},{sub:'other'},{event_name:'pull_request'},{workflow_ref:repo+'/.github/workflows/bisync.yml@'+ref},{exp:now-1},{iat:now+100},{iat:now-700},{exp:now+700},{run_id:'../private'}])await assert.rejects(authorize(token(patch),options),/UNAUTHORIZED/);
 for(const header of [{alg:'none'},{kid:'bad'},{crit:['jku']}])await assert.rejects(authorize(token({},header),options),/UNAUTHORIZED/);
 await assert.rejects(authorize(token().slice(0,-20)+'A',options),/UNAUTHORIZED/);
});
