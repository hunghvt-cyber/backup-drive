"""Scan sanitized test reports before committing. Never print a suspect value."""
import json, re, sys
from pathlib import Path
BANNED = {'password','authorization','user','probe','privateprobe','token','tokenhash','lock-token','rclone_config_content'}
def scan(value, path='$'):
    if isinstance(value, dict):
        for key, val in value.items():
            if key.lower() in BANNED:
                raise ValueError('forbidden key at '+path+'.'+key)
            scan(val,path+'.'+key)
    elif isinstance(value,list):
        for i,val in enumerate(value): scan(val,path+'['+str(i)+']')
    elif isinstance(value,str):
        if re.search(r'\b[a-f0-9]{32}\.[a-f0-9]{64}\b',value) or re.search(r'(?:opaquelocktoken:|urn:uuid:|Bearer\s|Basic\s+[A-Za-z0-9+/]{12})',value,re.I):
            raise ValueError('possible credential/lock token at '+path)
for name in sys.argv[1:]:
    data=json.loads(Path(name).read_text())
    scan(data)
    print(Path(name).name+': sanitized evidence scan passed')
