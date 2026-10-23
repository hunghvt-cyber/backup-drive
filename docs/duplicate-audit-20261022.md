# Duplicate audit and recoverable cleanup — 2026-10-22

This is a one-time operational investigation before creating a separate cloud-dedupe repository. No new web app has been deployed.

## Inventory evidence

- Read-only inventory run: https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/39806736634
- Drive: 23,648 file objects, 697,714,081,859 bytes; 1,415 content groups with 1,446 additional copies.
- Koofr GoogleBackup: 11,577 file objects, 167,792,119,563 bytes; 284 content groups with 314 additional copies.
- These content groups are not a deletion count. Archive manifests, backup versions, selected photo collections, and files intentionally placed in multiple directories can share content.
- GoogleBackup-Trash was absent. The aggregate inventory_failed flag reflects this optional missing source; Drive and GoogleBackup listings completed with no listing error.
- Drive contained 64 normalized-path collision groups: 38 Unicode-form variants and 26 identical raw paths. Of the identical raw paths, 25 were under protected Tapo-Archive. All 64 groups had matching size and MD5 within each group.
- Outside Tapo, 39 collision groups had one verified same-content Koofr counterpart.
- Six additional suffix variants matched an unsuffixed original on both sides.
- Fixed cleanup allow-list: 45 Drive objects (646,640,663 bytes), six Koofr files (603,278,312 bytes).

## Safety and evidence requirements

- Never combine both providers into one global duplicate deletion group: a corresponding object on each provider is an intended replica.
- Preserve raw Unicode paths and provider IDs alongside normalized comparison keys.
- Drive cleanup must address file IDs and recheck actual parent IDs, size, MD5/SHA256, ownership, sharing and trash capability.
- Keep shared or unowned deletion candidates unchanged. Preserve protected Tapo data and ambiguous cross-directory content matches.
- Koofr cleanup moves files into CloudDedupe-Quarantine outside GoogleBackup and verifies retained and quarantined content.
- Serialize maintenance with the existing gdrive-koofr-bisync concurrency group in this same repo. A future separate repo needs an actual cross-repository coordination mechanism.
- Do not reset, resync, or rewrite bisync baseline/cache for deduplication.
- Persist restoration identities before mutation. Detailed inventory and logs are private; public artifacts contain encrypted detail plus aggregate-only summary.
- A green workflow is insufficient: report verified mutation counts and skipped reasons. Initial cleanup run 39808454335 skipped all 45 candidates on HTTPError and changed zero source files. Separate read-only probes 39809355578 and 39809624033 succeeded, including target file metadata. Refresh/check native OAuth after long inventory and fail preflight before mutations if the API remains unavailable.

## Observed API failure and correction

The detailed encrypted error from run 39809997817 identified HTTP 403 rateLimitExceeded, on the shared rclone Google OAuth client project. This was a per-project requests-per-minute quota, not a missing file permission. No source files were changed in that attempt (43 rate-limit skips, two sharing/ownership/capability skips). Read-only probes had succeeded because the quota failure was intermittent. Do not diagnose HTTP 403 as an authorization problem without reading the provider error reason.

Use Drive fast-list, bounded native request rate, one request per second for direct metadata calls, and capped exponential retry for rateLimitExceeded/429/temporary server errors. Stop on a persistent systemic failure. Do not claim that the credential refresh itself fixed the root cause. A dedicated Google OAuth client is a future reliability improvement; do not change credentials during duplicate cleanup.

## Actual cleanup outcome

- Cleanup run: https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/39811260319
- 16 Drive file objects were moved to Drive Trash, totaling 30,250,304 bytes (30.25 MB decimal). All 16 passed the cleaner's immediate postchecks.
- 29 candidates were skipped by the ownership/sharing/trash-capability protection. They are not counted as deletions.
- Zero Koofr files were moved. All six suffix-pair removals depended on Drive candidates that were skipped.
- No protected Tapo data, ambiguous equal-content copies across directories, permanent purge, bisync reset, or credential change was performed.
- The workflow concluded failure because its strict exit condition treated protection skips as incomplete work. This was a partial cleanup with 16 verified changes, not zero changes. A future tool must report completed / protected / failed separately.
- Recovery journal was persisted on Koofr outside the bisync root before mutation. Private detail was also encrypted into the authorized seven-day GitHub artifact; no raw personal path or file ID is recorded in this document.
- Drive Trash retains data until removed through the provider retention/deletion flow. The 30.25 MB is the size of files moved to Trash, not confirmed quota reclaimed.

## Subsequent sync

The scheduled bisync run https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/39861984306 completed on 2026-10-22 at 22:12 UTC (2026-10-23 05:12 UTC+7), after the cleanup. Logs show NORMAL BISYNC, Rclone exit code 0, and BISYNC SUCCESS. This does not alone prove absence of recreated duplicate objects; a separate file-level read-only verification follows.

## Post-cleanup verification — 2026-10-23

- Full read-only verification: https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/39897312585
- All 16 original deletion targets remain trashed. All 16 retained Drive objects remain live with the expected size, MD5, and SHA256; their Koofr counterparts also match size and MD5. There were no API/read errors.
- Only one of the 16 locations has exactly one active normalized-name object. The other 15 each have two active objects. Thus the overall postchecks correctly fail for 15 locations; cleanup is not complete.
- All 29 protected candidates are owned by the account and have canTrash=true, but shared=true. They were intentionally preserved due to sharing, not because of missing technical permission.
- Focused identity verification: https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/39898010755
- The 15 additional active objects have new IDs absent from the original inventory. Each has identical size, MD5 and SHA256 to its keeper, a different raw Unicode name but the same NFC name, and is owned, unshared, and trashable.
- Eight new objects were created on 2026-10-22 at 20:01:37–20:01:52 UTC (2026-10-23 03:01 Vietnam); seven were created at 21:00:50–21:01:09 UTC (04:00–04:01 Vietnam). These were created after cleanup and before the inspected GitHub bisync began at 22:03 UTC (05:03 Vietnam).
- The GitHub sync already logged duplicate-source notices while listing, before its transfer stage. Therefore that inspected sync did not create these new objects. Their exact writer has not been identified; do not assign blame to rclone, NAS, desktop clients, Koofr, or GAS without provenance evidence.
- No further deletion is performed until the other writer is identified and coordinated. Repeatedly trashing regenerated objects would hide the unresolved cause.

## Requirements learned for the separate tool

1. Coordinate every writer, including other machines or cloud jobs. GitHub concurrency only excludes workflows in this repository and cannot stop another writer.
2. Track provider IDs, raw Unicode names, parent IDs and strong content hashes; detect newly created objects after cleanup, not only whether old IDs stay trashed.
3. Establish success after a subsequent normal sync and a fresh native-provider scan. A successful cleaner or bisync exit code alone is insufficient.
4. Keep protected shared candidates separate from permission failures. Removing a shared duplicate can break its direct file link even when another content-identical copy survives.
5. Keep per-operation recovery records, resume checkpoints, bounded retries and API reason codes. Report partial completion honestly.
6. Preserve intended cross-cloud replicas and intentional copies in different backup/selection directories.
7. The new cloud-dedupe repo/web UI remains a later implementation step. No new tool or production sync change was deployed during this investigation.

## Remaining blocker

Identify the separate writer responsible for the 03:01 and 04:00–04:01 Vietnam uploads, then coordinate it before removing the 15 regenerated Unicode duplicates. The 29 shared candidates (including all six linked Koofr cleanup pairs) remain protected. Production sync workflow, schedule, secrets, and baseline/cache remain unchanged.


## FolderSync retest cleanup — 2026-10-23

The operator reported one-way S25 Ultra backups with FolderSync and enabled Only resync source files if modified. Run https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/39911255393 then revalidated the fixed 15 regenerated objects, their retained counterparts and Koofr content. It persisted restoration identities outside the sync root, moved 15 objects (30,217,626 bytes) to Drive Trash, and verified all 16 keeper groups each have exactly one active normalized-name object. All 29 shared candidates remained untouched; zero Koofr files were moved. The maintenance workflow was restored to read-only verification. Production sync, schedule, credentials and baseline/cache were unchanged. The operator will now run both FolderSync folderpairs; prevention of recurrence is pending that retest.
