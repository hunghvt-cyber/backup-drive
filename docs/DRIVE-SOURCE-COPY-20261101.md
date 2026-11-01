# Drive-authoritative backup — 1 November 2026

## Decision and resulting behavior

The owner selected “Drive là nguồn chuẩn; Koofr chỉ nhận bản sao” in the task conversation. The implementation uses fixed-direction `rclone copy` and retains destination-only files. Replaced Koofr versions are moved to `GoogleBackup-Versions/<run_id>-<attempt>`; nothing is deleted from Drive. It preserves current exclusions, report source/workflow path, schedule and per-job budget. There is no automatic duplicate cleanup or retention of old versions.

The prior two-way preview [41267431752](https://github.com/hunghvt-cyber/backup-drive/actions/runs/41267431752) timed out without completing its plan. It proposed one copy toward Drive before stopping. This is not authorization to apply that plan; it is superseded by the fixed-direction policy. Old bisync state remains intact and is never loaded by the copy workflow.

## Release/verification gates

- The native local-fixture integration tests verify source hashes unchanged, destination-only file retention, replaced-version preservation, idempotency, dry-run non-mutation and Tapo exclusion.
- The cutover record triggers a read-only preview on main. Only completed preview success permits the dependent real copy job.
- A preview is not a backup and is rejected by the public report builder. Real result exit status controls reports, independently of publisher outcome. A timeout is incomplete/paused, not a completed backup.
- Preserve source-of-truth: metadata scan/aggregate counts do not prove every source object is backed up; excluded files, source duplicates and unavailable checksums remain limits.

Hosted CI, preview, real-copy results and Homepage readback must be recorded after observing the actual runs. This source-only record does not claim those future stages passed.
