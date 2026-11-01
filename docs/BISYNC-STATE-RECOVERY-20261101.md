# Bisync checkpoint repair — 1 November 2026

## Current status

Checkpoint validation/reporting is repaired. Remote data recovery is **not yet complete**. No remote data, baseline, ignore list, filter, schedule or runtime budget was changed by the investigation. No automatic resync/reset or fallback to an older snapshot is introduced.

The one-off PR audit used the shared production concurrency group and read-only operations. It never saved a cache or published raw listings/logs. It is removed from the final checks workflow to avoid repeating expensive cloud scans on future PRs; its reviewed source and run remain in Git history. Source comparison follows rclone v1.75.2 `operations.go`/`compare.go`; snapshot validation is not current remote-content verification.

## Incident evidence

| Run (ICT date) | Verified result |
| --- | --- |
| [40970527964](https://github.com/hunghvt-cyber/backup-drive/actions/runs/40970527964), 30 October | `Bisync successful`, exit 0; state cache saved. |
| [41140153373](https://github.com/hunghvt-cyber/backup-drive/actions/runs/41140153373), 31 October | SIGINT at 29-minute budget; `Graceful shutdown failed`, exit 124; failed state was cached. |
| [41246828486](https://github.com/hunghvt-cyber/backup-drive/actions/runs/41246828486), 1 November | Restored failed cache; missing primary listings; `--recover` rejected backup listings (3 Path1 and 41 Path2 unmatched rows), exit 7. GAS publication succeeded independently. |

Those 44 rows do not prove remote files were lost. The 31 October log also contains 38 queued Path1 deletion entries. That is a plan to propagate deletions toward Drive, not proof that 38 files were actually removed. Do not infer source-of-truth policy from those entries or blindly resync after deduplication.

## Implemented guard

- Validate the exact current listing pair with native rclone `--check-sync=only` in a temporary workdir before normal sync and before checkpoint promotion. Native snapshot checks use local backend stubs with unchanged path labels and no provider credentials/network access.
- Standalone native validation has no runtime Unicode AliasMap. Its read-only fallback recognizes NFC/NFD aliases only with matching known size/MD5. Redundant variants must also have identical known size/MD5; different-content, unknown-content or ambiguous duplicate aliases remain rejected. Original listing bytes and remote names are never rewritten. Exact unchanged paths retain native unknown-size/hash semantics, which cannot prove file-content parity.
- Validated state uses a new cache prefix. Rejected state is preserved under a prefix excluded from restore. A persisted review-required marker prevents the next scheduled run silently using an older valid snapshot after failure.
- Only explicit clean-shutdown log confirmation plus a valid listing pair can turn exit 124 into a safe pause. Failed shutdown remains failure in the Homepage report. Real engine error codes are preserved.
- Global listing/shutdown errors are fatal in the helper even alongside ignorable per-file errors. Rclone is pinned to 1.75.2.

## Live read-only qualification

[41267331693](https://github.com/hunghvt-cyber/backup-drive/actions/runs/41267331693) passed offline tests and qualified the historical listing pair under native comparison semantics: 11,108 logical NFC paths per side. Koofr lists 11,146 rows with 38 redundant Unicode variants, all with matching known size/MD5 within their group. Four exact-path metadata differences involve unavailable metadata under native comparison semantics; they are not proof of content parity. The current failed cache lacks the primary listing pair.

[41267431752](https://github.com/hunghvt-cyber/backup-drive/actions/runs/41267431752) restores both exact caches, copies the recorded filter `.md5` beside a generated scratch filter, and runs normal bisync **dry-run only** from a copy of the old checkpoint. Never generate a new expected filter hash to bypass native filter-change protection. This preview was still running when preparing the guarded repair; a green earlier probe that skipped the preview is not a completed recovery. Do not claim plan completeness without the final preview result.

Local validation: 32 unit tests pass; Python compilation, YAML parsing, Bash syntax and diff checks pass. Tests cover failed vs clean timeout, no unrelated/old/symlink listing acceptance, private-path-free summaries, strict Unicode alias equivalence and unknown metadata, and persistent review fencing. Hosted final checks are recorded on PR #11; the earlier audit used 30 tests before the two final fence tests were added.

## Recovery decision

Keep current failed state and known-good historical state intact. Inspect the complete preview before applying anything. In particular distinguish Drive writes/deletions from Koofr-only changes and account for duplicate cleanup, Unicode aliases and changes after the checkpoint. Rebuilding a baseline can restore deleted files.

If preserving two-way synchronization, qualify source-side operations before restoring a historical checkpoint; otherwise explicitly choose Drive as authoritative and design a one-way backup with recoverable handling of Koofr-only files. This repair does not silently change that policy or delete duplicate files.

Reference: https://rclone.org/bisync/#check-sync and https://rclone.org/bisync/#graceful-shutdown .
