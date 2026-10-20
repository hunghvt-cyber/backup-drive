"""Recover a real terminal aggregate from Actions artifacts, without backup access."""
import json
import os
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from publish_gas_report import normalize, publish, safe_error
REPO='hunghvt-cyber/my-backup-gdrive-koofr'

def reconstruct(run,jobs,job_log,artifact_root):
    run_id=run['id']
    if (run.get('repository',{}).get('full_name')!=REPO or run.get('path')!='.github/workflows/bisync.yml'
        or run.get('head_branch')!='main' or run.get('event')!='schedule'
        or run.get('status')!='completed' or run.get('run_attempt')!=1):
        raise ValueError('UNVERIFIED_BACKUP')
    matches=[j for j in jobs['jobs'] if j.get('name')=='run-bisync' and j.get('run_id')==run_id]
    if len(matches)!=1:
        raise ValueError('UNVERIFIED_BACKUP')
    steps={step['name']:step for step in matches[0]['steps']}
    for name in ('Run Bisync','Final Status','Upload Bisync Report'):
        if steps.get(name,{}).get('conclusion')!='success':
            raise ValueError('UNVERIFIED_BACKUP')
    # Match actual timestamped terminal output, never echoed script source.
    codes=re.findall(r'(?m)^\S+Z Initial rclone exit code: (\d+)\r?$',job_log)
    if codes!=['0']:
        raise ValueError('UNVERIFIED_BACKUP')
    root=Path(artifact_root)
    log=root/'bisync.log'
    if not log.is_file() or log.stat().st_size>8*1024*1024:
        raise ValueError('INVALID_ARTIFACT')
    text=log.read_text(errors='replace')
    if not re.search(r'Bisync successful',text):
        raise ValueError('UNVERIFIED_BACKUP')
    stats=re.findall(r'Transferred:\s*([\d.]+)\s*(GiB|MiB|TiB)\s*/\s*[\d.]+\s*(?:GiB|MiB|TiB),\s*\d+%,\s*([\d.]+)\s*(MiB|KiB|GiB)/s',text,re.I)
    if not stats:
        stats=re.findall(r'Transferred:\s*([\d.]+)\s*(GiB|MiB|TiB).*?,\s*([\d.]+)\s*(MiB|KiB|GiB)/s',text,re.I)
    amount=speed=None
    if stats:
        v,u,v2,u2=stats[-1]
        units={'kib':-1,'mib':0,'gib':1,'tib':2}
        amount=round(float(v)*1024**(units[u.lower()]-1),3)
        speed=round(float(v2)*1024**units[u2.lower()],3)
    ignored=root/'.sync-state/ignored-files.txt'
    ignored_count=len([x for x in ignored.read_text().splitlines() if x.strip()]) if ignored.is_file() else None
    finished=steps['Final Status']['completed_at']
    if not run['run_started_at']<=finished<=run['updated_at']:
        raise ValueError('UNVERIFIED_BACKUP_TIME')
    return {'schema_version':1,'source':'gdrive-koofr','run_id':run_id,
        'run_url':f'https://github.com/{REPO}/actions/runs/{run_id}','status':'success',
        'started_at':None,'finished_at':finished,'metrics':{'transferred_gib':amount,'speed_mib_s':speed,
        'ignored_count':ignored_count,'new_ignored_count':None},
        'warnings':['Có shortcut bị hỏng.'] if 'Dangling shortcut' in text else []}

def api(path,raw=False):
    req=Request('https://api.github.com/repos/'+REPO+path,headers={
        'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json'})
    try:
        with urlopen(req,timeout=20) as response:
            data=response.read(8*1024*1024+1)
    except HTTPError as error:
        raise ValueError('GITHUB_HTTP_'+str(error.code)) from None
    if len(data)>8*1024*1024:
        raise ValueError('RESPONSE_TOO_LARGE')
    return data.decode('utf-8') if raw else json.loads(data)

def main():
    run_id='39337249732'
    print('RECOVERY_STAGE=run_metadata')
    run=api('/actions/runs/'+run_id)
    print('RECOVERY_STAGE=jobs_metadata')
    jobs=api('/actions/runs/'+run_id+'/jobs')
    matches=[j for j in jobs['jobs'] if j.get('name')=='run-bisync']
    if len(matches)!=1:
        raise ValueError('UNVERIFIED_BACKUP')
    print('RECOVERY_STAGE=job_logs')
    logs=api('/actions/jobs/'+str(matches[0]['id'])+'/logs',raw=True)
    print('RECOVERY_STAGE=validate_original')
    report=reconstruct(run,jobs,logs,'recovery')
    env={**os.environ,'GITHUB_REPOSITORY':REPO,'GITHUB_RUN_ID':run_id,
        'GITHUB_RUN_NUMBER':str(run['run_number']),'GITHUB_RUN_ATTEMPT':str(run['run_attempt']),
        'GITHUB_WORKFLOW_REF':REPO+'/.github/workflows/bisync.yml@refs/heads/main'}
    normalize(report,env)
    print(json.dumps(publish(report,env),separators=(',',':')))
if __name__=='__main__':
    try:
        main()
    except Exception as error:
        code=str(error)
        if code not in ('UNVERIFIED_BACKUP','UNVERIFIED_BACKUP_TIME','INVALID_ARTIFACT','RESPONSE_TOO_LARGE','GITHUB_HTTP_401','GITHUB_HTTP_403','GITHUB_HTTP_404'):
            code=safe_error(error)
        print('REPORT_RECOVERY_FAILED: '+code,file=sys.stderr)
        raise SystemExit(1)
