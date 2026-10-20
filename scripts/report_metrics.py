"""Parse only rclone aggregate statistics, never filenames or arbitrary file lines."""
import re

ANSI=re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
NUMBER=r'(?:\d+(?:\.\d+)?)'
UNIT=r'(?:B|KiB|MiB|GiB|TiB|PiB)'
STAT=re.compile(r'^\s*(?:Transferred:\s*)?('+NUMBER+r')\s*('+UNIT+r')\s*/\s*'
    +NUMBER+r'\s*'+UNIT+r',\s*(?:\d+(?:\.\d+)?%|-),\s*('
    +NUMBER+r')\s*('+UNIT+r')/s(?:,\s*ETA\s+[^\r\n]+)?\s*$',re.I)
LOG_PREFIX=re.compile(r'^(?:\d{4}-\d\d-\d\dT\S+Z\s+)?\d{4}/\d\d/\d\d \d\d:\d\d:\d\d\s+(?:INFO|NOTICE)\s*:\s*')
FACTORS={'b':1,'kib':1024,'mib':1024**2,'gib':1024**3,'tib':1024**4,'pib':1024**5}

def parse_metrics(text):
    result=(None,None)
    for line in ANSI.sub('',text).splitlines():
        line=LOG_PREFIX.sub('',line)
        match=STAT.fullmatch(line)
        if match:
            amount,unit,speed,speed_unit=match.groups()
            result=(float(amount)*FACTORS[unit.lower()]/1024**3,
                    float(speed)*FACTORS[speed_unit.lower()]/1024**2)
    return result
