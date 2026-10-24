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

## Historical blocker before FolderSync identification

Identify the separate writer responsible for the 03:01 and 04:00–04:01 Vietnam uploads, then coordinate it before removing the 15 regenerated Unicode duplicates. The 29 shared candidates (including all six linked Koofr cleanup pairs) remain protected. Production sync workflow, schedule, secrets, and baseline/cache remain unchanged.


## FolderSync retest cleanup — 2026-10-23

The operator reported one-way S25 Ultra backups with FolderSync and enabled Only resync source files if modified. Run https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/39911255393 then revalidated the fixed 15 regenerated objects, their retained counterparts and Koofr content. It persisted restoration identities outside the sync root, moved 15 objects (30,217,626 bytes) to Drive Trash, and verified all 16 keeper groups each have exactly one active normalized-name object. All 29 shared candidates remained untouched; zero Koofr files were moved. The maintenance workflow was restored to read-only verification. Production sync, schedule, credentials and baseline/cache were unchanged. The operator will now run both FolderSync folderpairs; prevention of recurrence is pending that retest.


## Verification after the next scheduled cycle — 2026-10-24

- Scheduled GitHub bisync run: https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/40029415810 ; NORMAL BISYNC began 2026-10-23 21:48 UTC (2026-10-24 04:48 Vietnam), finished 21:58 UTC (04:58 Vietnam), rclone exit code 0.
- Fresh read-only audit: https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/40058110950 ; 1 of 16 keeper groups passed, 15 failed, with zero API/read errors.
- All 16 retained files remain live and match their previous size, MD5 and SHA256; all 16 original first-cleanup targets remain trashed. However 15 extra active objects have appeared again. Each matches its keeper in size, MD5 and SHA256, with a different raw Unicode name and the same normalized name. They are owned and unshared.
- Eight objects in the phone backup group were created 2026-10-23 20:01:12–20:01:28 UTC (2026-10-24 03:01 Vietnam); seven in the music group at 21:00:18–21:00:28 UTC (04:00 Vietnam). These timestamps are after the second cleanup and before the GitHub sync, establishing recurrence before that sync.
- The operator-reported FolderSync setting change has therefore not passed this recurrence test. Do not claim it solved the issue. Exact Folderpair configuration and filename handling still need inspection; current evidence does not establish why the setting was ineffective.
- No further files were deleted during this verification. Preserve evidence and inspect the phone backup configuration before repeating cleanup.


## Phone-preferred keeper migration — 2026-10-24

The operator authorized retaining the FolderSync-created file identities instead of the old NFC copies. A fixed salted metadata allow-list linked each old target to its existing phone-created keeper; no raw file names or IDs were published.

- Run: https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/40061302278 ; all steps completed successfully.
- Preserved all 15 phone-created objects with their exact IDs, raw names and contents. Moved the 15 old, owned, unshared NFC copies to Drive Trash (30,217,626 bytes), with fresh size/MD5/SHA256 and protection checks before mutation and identity/content checks afterwards.
- Fresh native Drive checks passed for all 16 keeper groups: exactly one active normalized-name object per group. All retained contents match the corresponding Koofr backup files.
- No Koofr backup data file was moved or renamed. Its exact raw path is recorded separately as koofr_path; the tool must not assume both providers use identical raw Unicode names.
- The 29 protected shared candidates remain untouched. Production bisync code, schedule, credentials and state were unchanged.
- A new private recovery and identity baseline was persisted outside the sync root before mutation and finalized after verification. The maintenance workflow was restored to read-only checks against baseline 40061302278 and supports provider-specific paths.

This changes the keeper selection policy, not the phone backup mode. It is a controlled hypothesis test: the operator must now run FolderSync, then verify absence of regenerated objects and retained content; the next ordinary GitHub bisync also needs verification. Do not claim recurrence is solved until these checks pass. In future cleanup, preserve app-managed raw names and IDs when content and protection checks permit; normalized names are comparison keys, not a reason to rewrite filenames.


## Phone retest after keeper migration — 2026-10-24

The operator reported running both FolderSync folderpairs after the keeper migration. Read-only run https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/40063063174 completed successfully: 16 checked groups, 16 passed, zero failed checks and zero read/API errors. Each retained Drive identity remains live with matching content, each cleanup target remains trashed, each normalized-name group contains exactly one active object, and the corresponding Koofr content matches. This confirms no recurrence within these 16 groups following this phone retest; it is not a claim that all equal-content files across both clouds have been removed.

A normal main-branch GitHub bisync was then dispatched for end-to-end verification: https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/40099455669 . All three optional inputs (resync, reset, extended_budget) were false. Production code and schedule were unchanged. This run and the subsequent read-only postcheck are pending.
