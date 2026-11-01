#!/usr/bin/env python3
"""Validate this job's exact listing pair, using rclone itself, without syncing.

Only counts/status are printed. Listing contents and provider errors stay private.
The check uses a temporary copy so it cannot rewrite the restored checkpoint.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

BASE = 'gdrive_..koofr__GoogleBackup'
PAIR = (BASE + '.path1.lst', BASE + '.path2.lst')
ANSI = re.compile(r'\x1b\[[0-9;]*m')


def eligible(exit_code, log):
    text = ANSI.sub('', log)
    if any(marker in text for marker in (
        'Graceful shutdown failed', 'Must run --resync',
        'path1 and path2 are out of sync',
    )):
        return False
    return exit_code == 0 or (
        exit_code == 124 and 'Graceful shutdown completed successfully.' in text
    )


def validate(workdir, filters, *, runner=subprocess.run):
    workdir, filters = Path(workdir), Path(filters)
    if not filters.is_file() or filters.is_symlink():
        return {'valid': False, 'reason': 'filters_missing'}
    for name in PAIR:
        p = workdir / name
        if not p.is_file() or p.is_symlink() or not p.stat().st_size:
            return {'valid': False, 'reason': 'listing_pair_missing'}
    with tempfile.TemporaryDirectory(prefix='bisync-check-') as tmp:
        for name in PAIR:
            shutil.copyfile(workdir / name, Path(tmp) / name)
        try:
            result = runner([
                'rclone', 'bisync', 'gdrive:/', 'koofr:/GoogleBackup',
                '--workdir', tmp, '--check-sync=only', '--checksum',
                '--filters-file', str(filters.resolve()), '--log-level', 'ERROR',
                '--color=NEVER',
            ], capture_output=True, text=True, timeout=45, check=False)
        except (OSError, subprocess.TimeoutExpired):
            return {'valid': False, 'reason': 'listing_check_unavailable'}
    return {'valid': result.returncode == 0,
            'reason': 'listing_pair_valid' if result.returncode == 0 else 'listing_pair_mismatch'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workdir', required=True)
    parser.add_argument('--filters', required=True)
    parser.add_argument('--exit-code', type=int)
    parser.add_argument('--log')
    args = parser.parse_args()
    if args.exit_code is not None:
        log = Path(args.log).read_text(errors='replace') if args.log and Path(args.log).is_file() else ''
        result = validate(args.workdir, args.filters) if eligible(args.exit_code, log) else {
            'valid': False, 'reason': 'run_not_checkpoint_eligible'}
    else:
        result = validate(args.workdir, args.filters)
    print(json.dumps(result))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as out:
            out.write(f"valid={str(result['valid']).lower()}\nreason={result['reason']}\n")


if __name__ == '__main__':
    main()
