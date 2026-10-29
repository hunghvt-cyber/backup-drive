# Backup/report recovery — 29 October 2026

## Evidence and scope

The canonical repositories were renamed: `backup-photos` is Drive/Koofr bisync,
`backup-drive` is Google Photos/Koofr. Do not infer their roles from their names.
The publishers at the failed run commits allowed only the former names, rejected
the actual GitHub repository identity before HTTP, then masked
`UNAPPROVED_REPOSITORY` as `REQUEST_FAILED`. A local reproduction made zero
network calls. This is separate from the media backup failures.

The publisher now explicitly allows the two canonical names and their historical
aliases, checks the actual repository/workflow and report run identity, then
normalizes only the public run URL to the historical GitHub alias already
accepted by deployed GAS and Homepage readers. Source labels and run IDs are
unchanged. These aliases refer to the same repositories; this does not authorize
other repositories, backfill-to-daily publishing, or arbitrary URL rewriting.
No GAS deployment, report key change or Homepage deployment is required.
Known validation errors remain explicit; unknown exception text remains redacted.

Offline checks cover both renamed sources, signed ACK verification, preserved
wire schema, rejected cross-source/workflow identities and bounded retries.
Both normalized failure reports were also accepted by the current Homepage GAS
schema source. This is local compatibility evidence, not a live signed GAS ACK.
No media backup or report was fabricated or replayed during local validation.

## Drive rate limiting

[Run 40783672841](https://github.com/hunghvt-cyber/backup-photos/actions/runs/40783672841)
failed around 06:00 ICT on 29 October: Drive API 403 rateLimitExceeded while
resolving a shortcut; rclone exited 7. The shell step intentionally returned 0
so state/report cleanup could run; Final Status correctly marked the job failed.

Reduce TPS from 5/burst 5 to 2/burst 1 and set Drive pacer minimum sleep to 500ms,
burst 1, including initial Drive probes via job environment. Keep checksum,
max-delete, destination trash, state, concurrency, runtime budget, and the
prohibition on automatic resync/retry. This mitigates request pressure but cannot
guarantee a shared Google project quota will be available. Do not interpret
quota errors as permanent ignorable files or delete shortcuts automatically.

Local suite: 17 tests pass; workflow YAML and bash syntax pass. A source-only
checks workflow runs without backup credentials. Live quota recovery must be
verified in a subsequent normal bounded run; no automatic resync is authorized.
