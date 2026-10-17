# Homepage Notes: isolated Koofr WebDAV probe — 17/10/2026

User authorized testing Koofr as file storage behind Homepage, with one-time setup.
Notes production remains on private Vercel Blob. This is NOT authorization to switch
storage, migrate real Notes, redeploy Homepage or modify backup/NAS workflows.

## Why this repository

my-backup-gdrive-koofr already has the base64 RCLONE_CONFIG_CONTENT Actions secret.
A separate experiment branch/workflow can authenticate to the SAME user's Koofr
inside the runner without copying credentials into chat, source or another repo.
Existing bisync.yml and duplicate-audit.yml remain byte-for-byte untouched. No merge
into main, no cron, rclone sync, Google API or NAS access. No changes to reports/GAS.

Probe accepts a native [koofr] remote only for provider=koofr/default endpoint and
primary storage, or a WebDAV remote exactly at app.koofr.net/dav/Koofr/. Rclone's
public documented obscuring format is decoded only in runner memory to authenticate
the existing connection. Other remote sections, Google tokens and backup files are
not used. Report records credential source only, never email/password/auth header.
No raw errors, remote XML, URLs or private filenames are logged.

## Live boundaries

Fixed origin https://app.koofr.net; redirects rejected. Random new root folder:
Homepage-Notes-WebDAV-Probe-<UUID>, outside GoogleBackup, GoogleBackup-Trash and all
Photos/recording paths. Requests cannot select arbitrary paths. Each run uses a new
namespace, refuses a pre-existing namespace, uses12s per request, no blind retry of
mutations, and has an8-minute Actions limit. Only a newly created delete-sample.md
is deleted after checking conditional DELETE. The tested note/folder are retained
for review; no recursive cleanup or deletion of existing files.

Conformance checks:
- MKCOL new namespace; create Unicode/Markdown checklist file with If-None-Match:*.
- Reject duplicate creation412; confirm original content unchanged.
- Strong ETag; conditional update; reject stale and invented ETags412, verify content.
-10 concurrent same-ETag writer pairs: exactly one success and one412, verify winner;
  same-length writes must change ETag, detecting timestamp-only/coarse validators.
- Deliberately discard a write response; GET reconciles content; retry same old ETag
  must412 without overwriting. This is not automatic cancellation or full app receipts.
- Conditional GET304 (recorded as optional capability).
-20 primary GET + PUT + readback samples, synthetic~2KB; no retries hidden as success.
- Conditional delete of its own throwaway fixture, verify404; PROPFIND own folder.

Report p50/p95 nearest rank on successful individual calls; failed calls remain in
counts. These are GitHub runner→Koofr measurements, not Vercel/iPad/company-network
or full Notes backend benchmarks. There is no100-Note index/share/ACL/history test,
large-file test, network-fault resilience, idle test, provider SLA or live migration.
App-level storage, shared links/revoke and idempotency still need design if DAV passes.

Six simulation tests pass: credential parser, disallowed remotes, normal conditional
CRUD/races/response discard, ignored preconditions/weak ETags, unsafe delete, redaction
and network/missing-setup failures. The fake server's latency is not a benchmark.

## One-time setup fallback (only if existing connection cannot authenticate)

Do not paste any password into chat. In Koofr generate a dedicated app password named
Homepage-WebDAV. In this repository Settings→Secrets and variables→Actions add:
KOOFR_WEBDAV_USER (Koofr email) and KOOFR_WEBDAV_APP_PASSWORD (generated app password).
The probe prefers these over the existing configuration. This does not update Vercel
secrets, replace the backup password or authorize production. For an eventual deployed
Homepage adapter, configure its own server-only secrets through the approved UI.

## Decision gate

Do NOT build a read-then-unconditional-write adapter to hide missing CAS. A412 response
must reflect correct atomic behavior under races and preserve data. If create/update
preconditions fail, stop and keep Notes on Blob; no production writes. Conditional
DELETE failure may require soft-delete via validated conditional PUT, but still blocks
the current full CRUD probe. A pass only allows considering a separate prototype.

Primary references:
- https://koofr.eu/help/koofr_with_webdav/how-do-i-connect-a-service-to-koofr-through-webdav/
- https://rclone.org/koofr/
- https://github.com/rclone/rclone/blob/v1.73.0/fs/config/obscure/obscure.go
- https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match

## Result

Pending actual Actions evidence; missing credentials/auth is not a WebDAV performance
failure. Any permission/setup requirement will be reported without revealing values.

### First live result

Commit4908efd, run38997788916:
https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/38997788916
Simulation6/6 passed. Existing native Koofr remote authenticated to WebDAV without
new user setup. MKCOL201~1110ms, PUT201~1111ms, verified Unicode GET200~451ms.
Second PUT to the SAME file with If-None-Match:* returned201~1146ms instead of412;
probe stopped before concurrent/update/latency samples. This status alone needs
readback before claiming actual overwrite. Evidence docs/results/webdav-live-20261017.json,
artifact12087199750. This is a failed safety gate, not a completed benchmark.

Follow-up is separately gated [webdav-verify], fixed to the exact retained UUID
namespace from this run. It reads the file, checks OPTIONS DAV/Allow, tries an invalid
If-Match only against its own synthetic note and reads back. No extra folders,
production Notes, backup files or credentials setup. Do not repeat the original
probe just to hide its failure. No CAS claim without checking preserved content.
