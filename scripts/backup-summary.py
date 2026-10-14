"""Produce a small public-safe report from local bisync logs, never include file names."""
import json, os, re
from datetime import datetime, timezone
from pathlib import Path
logs=[Path(x) for x in ("bisync.log","bisync-retry.log") if Path(x).is_file()]
text="\n".join(p.read_text(errors="replace") for p in logs)
def last(pattern):
    m=re.findall(pattern,text,re.I|re.M)
    return m[-1] if m else None
# rclone one-line progress (different versions may use GiB/MiB and /s suffix).
stats=re.findall(r"Transferred:\s*([\d.]+)\s*(GiB|MiB|TiB)\s*/\s*[\d.]+\s*(?:GiB|MiB|TiB),\s*\d+%,\s*([\d.]+)\s*(MiB|KiB|GiB)/s",text,re.I)
if not stats:
    stats=re.findall(r"Transferred:\s*([\d.]+)\s*(GiB|MiB|TiB).*?,\s*([\d.]+)\s*(MiB|KiB|GiB)/s",text,re.I)
def conv(v,unit,base):
    return round(float(v)*1024**({"KiB":-1,"MiB":0,"GiB":1,"TiB":2}[unit.title().replace("Kib","KiB").replace("Mib","MiB").replace("Gib","GiB").replace("Tib","TiB")]-base),3)
amount=speed=None
if stats:
    v,u,v2,u2=stats[-1]
    amount=conv(v,u,1)
    speed=conv(v2,u2,0)
ignored_file=Path(".sync-state/ignored-files.txt")
ignored=len([line for line in ignored_file.read_text().splitlines() if line.strip()]) if ignored_file.exists() else None
new=os.getenv("NEW_IGNORED","")
rc=os.getenv("RCLONE_RC","")
retry=os.getenv("RETRY_RC","")
status="success" if rc=="0" or retry=="0" else ("paused" if rc=="124" or retry=="124" else "failure")
report={"run_id":int(os.environ["GITHUB_RUN_ID"]),"run_url":f"https://github.com/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}",
"status":status,"transferred_gib":amount,"speed_mib_s":speed,"ignored_count":ignored,
"new_ignored_count":int(new) if new.isdigit() else None,
"finished_at":datetime.now(timezone.utc).isoformat().replace("+00:00","Z"),
"warning":"Có shortcut bị hỏng. File bị bỏ qua không được backup." if "Dangling shortcut" in text else "Các file bị bỏ qua không được backup."}
Path("backup-summary.json").write_text(json.dumps(report,ensure_ascii=False))
print("Prepared sanitized summary",report["run_id"],status)
