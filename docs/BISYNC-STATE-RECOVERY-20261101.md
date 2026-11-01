# Bisync checkpoint incident — 1 November 2026

## Evidence

- Last successful engine run: [40970527964](https://github.com/hunghvt-cyber/backup-drive/actions/runs/40970527964), 30 October ICT. Log contains `Bisync successful`, exit 0 and saved state cache.
- [41140153373](https://github.com/hunghvt-cyber/backup-drive/actions/runs/41140153373), 31 October ICT: SIGINT at the 29-minute limit, `Graceful shutdown failed`, exit 124. Failed state was still cached.
- [41246828486](https://github.com/hunghvt-cyber/backup-drive/actions/runs/41246828486), 1 November ICT: restored that failed state, missing primary listings, attempted `--recover`, backup-listing mismatch (3 Path1 and 41 Path2 unmatched rows), exit 7. Report publication succeeded separately.
- The 44 rows are listing discrepancies, not evidence that 44 remote files were lost. Logs include duplicate-object notices and Unicode variants; no deduplication or path normalization is authorized by this repair.

## Repair

The workflow validates the exact listing pair with rclone `--check-sync=only` in a temporary workdir before normal sync and before promoting a checkpoint. Old caches are preserved. Validated checkpoints use a new prefix; rejected state uses a prefix excluded from restore. A timeout is a safe pause only after explicit clean shutdown and successful native listing validation. Engine errors remain failures in the Homepage report. Global listing and ungraceful-shutdown errors are fatal in the helper even alongside ignorable per-file errors. Rclone is pinned to the incident version, 1.75.2.

Native listing checks validate snapshots, not current remote contents. They do not authorize fallback to any older snapshot. This repair does not change remotes, filters, delete limits, schedule, runtime budget, or automatically run `--resync`/`reset`.

## Read-only recovery qualification

The incident PR has an exact-branch, same-repository audit job after offline tests. It restores the exact current and last-success caches, validates each and, only if the last-success listing pair is valid, runs normal bisync `--dry-run` from a temporary copy. It shares the production sync concurrency group, has no cache-save step, emits bounded counts without filenames, and deletes raw probe logs/credentials. A preview result is not a completed backup. An incomplete preview or any planned write back to Drive requires further review before changing live state.

## Validation status

Local: 29 unit tests pass, including failed-shutdown vs clean-pause handling, native-check failure/timeout, copied check workdir, incomplete/old listing rejection, symlink rejection, global error classification, and private-path-free preview summaries. YAML parsing and shell syntax are checked separately. Hosted CI, restored-cache results and any subsequent production recovery must be recorded from actual runs below; none is claimed by this source record.

Reference: https://rclone.org/bisync/#check-sync and https://rclone.org/bisync/#graceful-shutdown .


### Hosted checkpoint qualification (PR #11)

Run [41267009969](https://github.com/hunghvt-cyber/backup-drive/actions/runs/41267009969) passed 29 offline tests and restored both exact caches. The 1 November cache has no primary listing pair. The 30 October checkpoint fails standalone native listing comparison, and its Unicode equivalence check detects a collision, so the recovery preview was correctly skipped. This is **not a recovery success**. No old snapshot was substituted and no remote write was performed. Native checks now use local backend stubs with the same path labels in a temporary workdir, since they check snapshot metadata only; provider OAuth/network is irrelevant to that check. Unique NFC/NFD aliases require identical known size/MD5, while ambiguous collisions remain blocked. Current remote integrity still needs separate verification.
