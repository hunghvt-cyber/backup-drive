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
import unicodedata

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


LINE = re.compile(r'^(\S) +(-?\d+) (\S+) (\S+) (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{9}[+-]\d{4}) (".+")$')


def compare_unicode_pair(workdir):
    """Read-only NFC equivalence for unique paths with identical size/hash.

    rclone's standalone check starts with an empty runtime AliasMap, so it can
    reject a valid NFC/NFD pair that passed at the end of the actual sync.
    We never normalize the checkpoint or a remote name. Unknown hashes and
    normalization collisions fail closed in this fallback.
    """
    sides = []
    try:
        for name in PAIR:
            rows = {}
            lines = (Path(workdir) / name).read_text().splitlines()
            if not lines or not lines[0].startswith('# bisync listing v1 from '):
                return {'equivalent': False, 'reason': 'unsupported_listing'}
            for line in lines[1:]:
                if not line:
                    continue
                match = LINE.fullmatch(line)
                if not match:
                    return {'equivalent': False, 'reason': 'unsupported_listing'}
                flag, size, digest, _, _, encoded = match.groups()
                path = json.loads(encoded)
                normalized = unicodedata.normalize('NFC', path)
                if normalized in rows:
                    return {'equivalent': False, 'reason': 'unicode_collision'}
                if flag != '-' or int(size) < 0 or not re.fullmatch(r'md5:[a-fA-F0-9]{32}', digest):
                    return {'equivalent': False, 'reason': 'unverifiable_metadata'}
                rows[normalized] = (int(size), digest.lower())
            sides.append(rows)
    except (OSError, ValueError):
        return {'equivalent': False, 'reason': 'unsupported_listing'}
    left, right = sides
    unmatched = len(left.keys() ^ right.keys())
    changed = sum(left[k] != right[k] for k in left.keys() & right.keys())
    return {'equivalent': bool(left) and unmatched == 0 and changed == 0,
            'reason': 'unicode_pair_comparison', 'unmatched': unmatched,
            'metadata_mismatch': changed, 'entries': [len(left), len(right)]}


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
    if result.returncode == 0:
        return {'valid': True, 'reason': 'listing_pair_valid'}
    # Native check errors about auth/config/timeout must never be bypassed.
    native_log = ANSI.sub('', result.stdout + result.stderr)
    if 'path1 and path2 are out of sync' not in native_log:
        return {'valid': False, 'reason': 'native_check_failed'}
    comparison = compare_unicode_pair(workdir)
    return {'valid': comparison['equivalent'],
            'reason': 'unique_unicode_pair_valid' if comparison['equivalent'] else 'listing_pair_mismatch',
            'comparison': comparison}


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
