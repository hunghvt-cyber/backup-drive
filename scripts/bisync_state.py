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
    We never normalize the checkpoint or a remote name. Unknown hashes on renamed aliases, colliding paths with different content,
    and ambiguous duplicate records fail closed. Redundant Unicode variants
    are accepted only with identical known size/MD5; all originals are retained. Exact unchanged names retain the native size/hash comparison.
    """
    sides = []
    collision_stats = []
    try:
        for name in PAIR:
            rows = {}
            collisions = different_content = exact_duplicates = unverified_duplicates = row_count = 0
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
                row_count += 1
                if normalized in rows:
                    collisions += 1
                    prior = rows[normalized]
                    exact_duplicates += path == prior[3]
                    different_content += (flag, int(size), digest.lower()) != prior[:3]
                    unverified_duplicates += flag != '-' or int(size) < 0 or not re.fullmatch(r'md5:[a-fA-F0-9]{32}', digest)
                    continue
                if flag not in ('-', 'd') or (digest != '-' and not re.fullmatch(r'md5:[a-fA-F0-9]{32}', digest)):
                    return {'equivalent': False, 'reason': 'unsupported_metadata'}
                rows[normalized] = (flag, int(size), digest.lower(), path)
            sides.append(rows)
            collision_stats.append({'rows': row_count, 'unique_nfc': len(rows),
                                    'collisions': collisions, 'exact_duplicates': exact_duplicates,
                                    'different_metadata': different_content, 'unverified_duplicates': unverified_duplicates})
    except (OSError, ValueError):
        return {'equivalent': False, 'reason': 'unsupported_listing'}
    if any(side['different_metadata'] or side['exact_duplicates'] or side['unverified_duplicates'] for side in collision_stats):
        return {'equivalent': False, 'reason': 'unicode_collision', 'sides': collision_stats}
    left, right = sides
    unmatched = len(left.keys() ^ right.keys())
    # Match rclone 1.75.2 sizeDiffers/hashDiffers for exact names: unknown
    # metadata is not a proven difference. Unicode aliases still require
    # identical known size/MD5 below, so unknown data cannot establish aliases.
    def differs(a, b):
        return a[0] != b[0] or (a[1] >= 0 and b[1] >= 0 and a[1] != b[1]) or (
            a[2] != '-' and b[2] != '-' and a[2] != b[2])
    changed = sum(differs(left[k], right[k]) for k in left.keys() & right.keys())
    strict_changed = sum(left[k][:3] != right[k][:3] for k in left.keys() & right.keys())
    unverified_aliases = sum(
        left[k][3] != right[k][3] and (left[k][0] != '-' or left[k][1] < 0 or right[k][1] < 0 or left[k][2] == '-' or right[k][2] == '-' or left[k][:3] != right[k][:3])
        for k in left.keys() & right.keys()
    )
    return {'equivalent': bool(left) and unmatched == 0 and changed == 0 and unverified_aliases == 0,
            'reason': 'unicode_pair_comparison', 'unmatched': unmatched,
            'metadata_mismatch': changed, 'strict_metadata_difference': strict_changed, 'unverified_aliases': unverified_aliases, 'sides': collision_stats, 'entries': [len(left), len(right)]}


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
            # check-sync=only reads listing snapshots, not remotes. Keep the
            # original remote labels but use local backend stubs to avoid
            # OAuth/network requests while performing this metadata check.
            result = runner([
                'rclone', 'bisync', 'gdrive:/', 'koofr:/GoogleBackup',
                '--workdir', tmp, '--check-sync=only', '--checksum',
                '--filters-file', str(filters.resolve()), '--log-level', 'ERROR',
                '--color=NEVER', '--config', os.devnull,
            ], capture_output=True, text=True, timeout=45, check=False,
                env={**{k: v for k, v in os.environ.items() if not k.startswith('RCLONE_')},
                     'RCLONE_CONFIG_GDRIVE_TYPE': 'local',
                     'RCLONE_CONFIG_KOOFR_TYPE': 'local'})
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
