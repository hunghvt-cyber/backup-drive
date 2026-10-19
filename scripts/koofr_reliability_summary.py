"""Summarize recorded functional checks; not a randomized performance benchmark."""
import json, sys, hashlib, gzip, math
from pathlib import Path
p=Path(sys.argv[1]);raw=p.read_bytes();r=json.loads(raw)
def stats(v):
    v=sorted(v)
    return {'n':len(v),**{k:(round(v[max(0,math.ceil(q*len(v))-1)],2) if v else None) for k,q in [('p50',.5),('p95',.95),('max',1)]}}
req=r.get('requests',[])
endpoints=[]
for i in range(2):
    rows=[x for x in req if x.get('endpoint')==i]
    endpoints.append({'endpoint':i,'invocations':len(rows),'runtimeIds':sorted({x['runtimeId'] for x in rows if x.get('runtimeId')}),'regions':sorted({x['region'] for x in rows if x.get('region')})})
metrics=[m for x in req if x.get('stage')=='race-write' for m in x.get('metrics',[]) if m.get('operation')=='save-note']
summary={
 'kind':'KOOFR_FULL_STORE_RELIABILITY_SUMMARY','at':r.get('at'),'passed':r.get('passed'),'completed':r.get('completed'),
 'deployedCode':r.get('deployedCode'),'driverCode':r.get('driverCode'),'deployments':r.get('deployments'),
 'summary':r.get('summary'),'errors':r.get('errors'),'faults':r.get('faults'),'crossDeploymentRevoke':r.get('crossDeploymentRevoke'),'final':r.get('final'),
 'endpoints':endpoints,'requestIdsVerifiedUnique':r.get('requestIdsVerifiedUnique'),
 'raceSavesPublishedServerMs':stats([m['ms'] for m in metrics if m.get('code')=='OK' and m.get('committed')]),
 'sameNotePairWallMs':stats([x['wallMs'] for x in r.get('races',[]) if x['kind']=='same']),
 'differentNotePairWallMs':stats([x['wallMs'] for x in r.get('races',[]) if x['kind']=='different']),
 'sourceBytes':len(raw),'sourceSha256':hashlib.sha256(raw).hexdigest(),
 'limitations':['Functional checks, not an iPad benchmark or SLA','Intentional faults/lease waits and BUSY are kept separate from published-save timings','Configured/deployment and VERCEL_REGION say fra1; runtime-log envelope reported iad1, physical region not independently settled','No literal process kill, long provider outage, cross-region soak or production API/UI tested']}
gz=gzip.compress(raw,compresslevel=9,mtime=0);target=Path('docs/results/koofr-store-reliability-live-20261017.json.gz');target.write_bytes(gz)
summary['gzipBytes']=len(gz);summary['gzipSha256']=hashlib.sha256(gz).hexdigest()
Path('docs/results/koofr-store-reliability-summary-20261017.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:summary[k] for k in ['passed','completed','summary','raceSavesPublishedServerMs','sameNotePairWallMs','differentNotePairWallMs','sourceBytes','gzipBytes']},indent=2))
