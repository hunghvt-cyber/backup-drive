#!/usr/bin/env python3
"""Print only bounded counts from a read-only recovery preview, never paths."""
import json
from pathlib import Path
import re
import sys


def summarize(log, exit_code):
    lines = log.splitlines()
    return {
        'dry_run': True,
        'exit_code': exit_code,
        'complete': exit_code == 0 and 'Bisync successful' in log,
        'queue_copy_to_drive': sum(bool(re.search(r'\bINFO\s*:\s*-\s+Path2\s+Queue copy to\s+Path1\s+-', x)) for x in lines),
        'queue_copy_to_koofr': sum(bool(re.search(r'\bINFO\s*:\s*-\s+Path1\s+Queue copy to\s+Path2\s+-', x)) for x in lines),
        'queue_delete_drive': sum(bool(re.search(r'\bINFO\s*:\s*-\s+Path1\s+Queue delete\s+-', x)) for x in lines),
        'queue_delete_koofr': sum(bool(re.search(r'\bINFO\s*:\s*-\s+Path2\s+Queue delete\s+-', x)) for x in lines),
        'rename_drive': sum(bool(re.search(r'\bINFO\s*:\s*-\s+Path1\s+Renaming', x)) for x in lines),
        'duplicate_notices': sum('Duplicate object found' in x for x in lines),
        'errors': sum(bool(re.search(r'\bERROR\s*:', x)) for x in lines),
        'ungraceful_shutdown': 'Graceful shutdown failed' in log,
        'state_mismatch': 'path1 and path2 are out of sync' in log,
        'filters_checksum_missing': 'filters file md5 hash not found' in log,
        'filters_changed': 'filters file has changed' in log,
        'lock_blocked': 'prior lock file' in log or 'existing lock' in log,
        'missing_listings': 'cannot find prior' in log or 'cannot read prior listing' in log,
        'auth_error': 'invalid_grant' in log or '401 Unauthorized' in log,
    }


if __name__ == '__main__':
    print(json.dumps(summarize(Path(sys.argv[1]).read_text(errors='replace'), int(sys.argv[2]))))
