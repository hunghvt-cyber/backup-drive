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


## Verified release — 1 November 2026

- PR [#12](https://github.com/hunghvt-cyber/backup-drive/pull/12), runtime source `0fcdcd44623e33201b84511c740353ecdb1d5ca3`: [37-test CI](https://github.com/hunghvt-cyber/backup-drive/actions/runs/41277105605) passed, including both native rclone fixture tests (no skips).
- [Cutover run 41277152906](https://github.com/hunghvt-cyber/backup-drive/actions/runs/41277152906) preview passed at 05:48:29 UTC. Real copy then ran 05:48:38–06:03:29 UTC (12:48:38–13:03:29 ICT), exit 0, complete=true. Both jobs and the overall run succeeded.
- Real copy aggregate: 11,137 identical comparison entries, 18 source-only entries, 3 destination-only entries retained, 0 differing/error entries, transferred_gib=0.0006510677337646484. Combined counts are rclone logger/comparison records, not a per-object independent restoration audit. No replacement was needed in this run; preservation of replaced versions is proven by the native fixture, not by a nonexistent production replacement.
- Publisher emitted signed-ACK-verified `published=true`, source gdrive, run_attempt=1, replay=false at 06:03:34 UTC. Fresh Homepage `/api/backup-report?source=gdrive` readback returned HTTP 200, run_id=41277152906, run_number=96, status=success, finished_at=2026-11-01T06:03:29.744093Z, GAS received_at=2026-11-01T06:03:33.406Z, recovered_previous=false. Reporting success is thus tied to this completed copy, not just a workflow badge.
- Coverage limits remain: 28 ignored paths, no newly ignored paths, a dangling-shortcut warning and 23 duplicate-object notices. Unknown checksums and duplicate source names are not complete object-level backup proof. No automatic deduplication, extra-file deletion or version cleanup was performed.
- PR [#13](https://github.com/hunghvt-cyber/backup-drive/pull/13), main `bc497277f811be0b8eb29b1f281d718c909f451d`, separates rerun cache/artifact identities. Its CI passed; the first cutover itself used the original runtime source above.
- Homepage [PR #35](https://github.com/hunghvt-cyber/web-home/pull/35) changed only the card arrow. Production READY `dpl_CBPpWonq1e1G6jL1ZMnbCvQkamGB`, commit `7057ad6c8a18c11a8c61243e5c70c10dda8d925e`, aliases include homepage-nas.vercel.app. Public HTML HTTP 200 contains the one-way label and no old two-way card label. Local build with QR and 104 tests passed.

## Steady-state operation after acceptance

Remove the incident-only push trigger after successful cutover. Keep the decision record, source history and existing data intact. Only the original 02:00 ICT schedule and explicit workflow_dispatch remain. Manual previews never publish backup reports; a real-copy timeout remains incomplete/paused. No new cron, secret, paid runner, NAS process or external management service is added.
