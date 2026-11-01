"""Produce the public-safe aggregate; previews never become backup reports."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from report_metrics import parse_metrics


def build_report(env, root=Path('.')):
    copy_path = root / 'copy-result.json'
    copy_result = json.loads(copy_path.read_text()) if copy_path.exists() else None
    if copy_result:
        if copy_result['dry_run']:
            raise ValueError('PREVIEW_MUST_NOT_PUBLISH_BACKUP_REPORT')
        if copy_result['mode'] != 'drive-to-koofr-copy' or type(copy_result['exit_code']) is not int:
            raise ValueError('INVALID_COPY_RESULT')
        rc, retry = str(copy_result['exit_code']), ''
        logs = [root / '.copy-state/private/copy.log']
        ignored_file = root / '.copy-state/ignored-files.txt'
    else:
        rc, retry = env.get('RCLONE_RC', ''), env.get('RETRY_RC', '')
        logs = [root / name for name in ('bisync.log', 'bisync-retry.log')]
        ignored_file = root / '.sync-state/ignored-files.txt'
    text = '\n'.join(p.read_text(errors='replace') for p in logs if p.is_file())
    amount, speed = parse_metrics(text)
    ignored = len([x for x in ignored_file.read_text().splitlines() if x.strip()]) if ignored_file.exists() else None
    new = env.get('NEW_IGNORED', '')
    status = 'success' if rc == '0' or retry == '0' else ('paused' if rc == '124' or retry == '124' else 'failure')
    return {'schema_version': 1, 'source': 'gdrive-koofr', 'run_id': int(env['GITHUB_RUN_ID']),
            'run_url': f"https://github.com/{env['GITHUB_REPOSITORY']}/actions/runs/{env['GITHUB_RUN_ID']}",
            'status': status,
            'metrics': {'transferred_gib': amount, 'speed_mib_s': speed, 'ignored_count': ignored,
                        'new_ignored_count': int(new) if new.isdigit() else None},
            'started_at': copy_result['started_at'] if copy_result else None,
            'finished_at': copy_result['finished_at'] if copy_result else datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            'warnings': ['Có shortcut bị hỏng.'] if 'Dangling shortcut' in text else []}


if __name__ == '__main__':
    report = build_report(os.environ)
    Path('backup-summary.json').write_text(json.dumps(report, ensure_ascii=False))
    print('Prepared sanitized summary', report['run_id'], report['status'])
