#!/usr/bin/env python3
"""Fixed-direction, non-deleting Drive backup. Print aggregates only."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
from report_metrics import parse_metrics

SOURCE = 'gdrive:'
DESTINATION = 'koofr:GoogleBackup'


def command(run_id, attempt, filters, combined, *, dry_run=False):
    if not re.fullmatch(r'[1-9][0-9]*', str(run_id)) or not re.fullmatch(r'[1-9][0-9]*', str(attempt)):
        raise ValueError('INVALID_RUN_IDENTITY')
    args = ['rclone', 'copy', SOURCE, DESTINATION,
            '--checksum', '--fast-list', '--drive-acknowledge-abuse',
            '--backup-dir', f'koofr:GoogleBackup-Versions/{run_id}-{attempt}',
            '--filter-from', str(filters), '--combined', str(combined),
            '--transfers', '8', '--checkers', '16', '--retries', '1',
            '--stats', '30s', '--stats-one-line', '--log-level', 'INFO', '--color', 'NEVER']
    if dry_run:
        args.append('--dry-run')
    return args


def summary(log, combined, rc, dry_run, started):
    amount, speed = parse_metrics(log)
    counts = {'identical': 0, 'source_only': 0, 'destination_only_retained': 0,
              'different': 0, 'comparison_errors': 0}
    labels = {'=': 'identical', '+': 'source_only', '-': 'destination_only_retained',
              '*': 'different', '!': 'comparison_errors'}
    for line in combined.splitlines():
        if len(line) >= 2 and line[0] in labels and line[1] == ' ':
            counts[labels[line[0]]] += 1
    errors = {
        'auth': bool(re.search(r'invalid_grant|401 Unauthorized', log)),
        'rate_limit': bool(re.search(r'rateLimitExceeded|Error 429|quotaExceeded', log)),
        'permission': 'insufficientFilePermissions' in log,
        'blocked': 'FileBlocked' in log,
        'service': bool(re.search(r'Error 50[0234]|Got 50[0234]', log)),
        'timeout': rc in (124, 137),
    }
    return {'mode': 'drive-to-koofr-copy', 'dry_run': dry_run, 'exit_code': rc,
            'complete': rc == 0, 'started_at': started,
            'finished_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            'transferred_gib': amount, 'speed_mib_s': speed,
            'comparison_counts': counts, 'error_categories': errors,
            'comparison_counts_complete': rc == 0,
            'duplicate_notices': log.count('Duplicate object found'),
            'scope': 'configured_filters',
            'destination_only_policy': 'retain', 'replaced_file_policy': 'version-on-koofr'}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--seconds', type=int, default=1740)
    args = p.parse_args()
    if not 1 <= args.seconds <= 1740:
        raise ValueError('INVALID_BUDGET')
    root = Path('.copy-state')
    if not (root / 'filters.txt').is_file():
        raise ValueError('COPY_FILTER_REQUIRED')
    private = root / 'private'
    private.mkdir(parents=True, exist_ok=True, mode=0o700)
    log_path, combined_path = private / 'copy.log', private / 'combined.txt'
    started = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    cmd = ['timeout', '--signal=INT', '--kill-after=120s', str(args.seconds)+'s'] + command(
        os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT'], root / 'filters.txt',
        combined_path, dry_run=args.dry_run)
    with log_path.open('w') as log:
        try:
            rc = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, check=False).returncode
        except OSError:
            rc = 127
    text = log_path.read_text(errors='replace')
    combined = combined_path.read_text(errors='replace') if combined_path.exists() else ''
    result = summary(text, combined, rc, args.dry_run, started)
    Path('copy-result.json').write_text(json.dumps(result))
    print(json.dumps(result))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as out:
            out.write(f'exit_code={rc}\ncomplete={str(rc == 0).lower()}\n')


if __name__ == '__main__':
    main()
