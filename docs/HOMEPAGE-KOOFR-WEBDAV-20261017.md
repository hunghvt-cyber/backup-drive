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
preconditions fail, stop the ETag adapter experiment and keep Notes on Blob; no
production writes. A separately verified exclusive-lock design is a different
prototype and must not inherit any CAS claims from the ETag experiment. Conditional
DELETE failure may require soft-delete via validated conditional PUT, but still blocks
the current full CRUD probe. A pass only allows considering a separate prototype.

Primary references:
- https://koofr.eu/help/koofr_with_webdav/how-do-i-connect-a-service-to-koofr-through-webdav/
- https://rclone.org/koofr/
- https://github.com/rclone/rclone/blob/v1.73.0/fs/config/obscure/obscure.go
- https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match

## Result

Actual evidence is recorded below. Credential reuse succeeded without additional
user setup. These results do not authorize a production migration.

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

### Precondition readback diagnostic

Commitc680e7e, run38997916545:
https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/38997916545
Readback confirmed duplicate If-None-Match:* PUT actually replaced the synthetic
file. PUT with a guaranteed-invalid If-Match also returned201~1184ms and readback
confirmed its new content, despite a strong ETag being available. Therefore direct
ETag-conditional writes cannot be treated as safe on this tested endpoint.
Evidence docs/results/webdav-preconditions-20261017.json. OPTIONS advertised DAV1,2
and LOCK/UNLOCK; this advertisement alone does not establish working locks.

Final bounded follow-up [webdav-lock] tests exclusive LOCK on the same synthetic
file, competing lock423, denied writer/readback, own-token write, UNLOCK, then stale
token write denial/readback.10 simulated tests passed including ineffective/fake
locks and stale token fencing failures. Own active lock is released best-effort;
requested timeout60s, token never logged. A pass only permits a separate lock-aware
adapter design; failure blocks a simple password→WebDAV Notes replacement.

### Initial exclusive-lock result and bounded stress test

Commit300cbb2, run38998091553 passed the actual lock diagnostic:
https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/38998091553
Competing LOCK423; tokenless PUT423 with content preserved; own-token PUT201
verified by GET; UNLOCK204; stale-token PUT412 with content preserved.
Evidence docs/results/webdav-lock-initial-20261017.json. Requested timeout60s was
not advertised in a response header; lock expiry/crash recovery remains untested.

The next opt-in stress run uses this same synthetic file only:10 concurrent LOCK
pairs, winner writes with its token and verifies content, loser reacquires and
checks its ORIGINAL base hash under lock before returning simulated app409 without
a stale PUT. Then10 full LOCK→GET base check→PUT(token)→GET readback→UNLOCK save
cycles are timed.11 simulation tests cover the implementation, not live guarantees.
This measures a locking primitive from GitHub Actions, not a production adapter.
No Note index, share permissions, idempotent receipts, restore or Vercel/iPad route
is implemented. WebDAV If-Match is still unsafe; revision must be checked AFTER
acquiring the lock and every content mutation must carry the current lock token.

### Live lock stress result and decision

Commit9a7285d, run38998278850 passed simulation11/11 and live diagnostic:
https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/38998278850
Evidence docs/results/webdav-lock-stress-20261017.json:150 HTTP calls,10/10
concurrent lock pairs exclusive, every losing editor detected its stale base after
reacquiring the lock.10/10 full save cycles completed, p50=3038ms, p95=4804ms
(nearest rank; with n=10 p95 is the maximum). No observed errors, no held lock left.
Each cycle saved~2KB Unicode Markdown/checklist, with five sequential requests.
This is a small single-run GitHub Actions benchmark; it does not demonstrate
timeout probability, sustained reliability, app-level conflict handling or speed
from Vercel/company network/iPad. No claim of Keep-like confirmed-save latency.

Decision: Koofr credentials already work, so no additional user setup is necessary
for this isolated test. LOCK-aware storage is a candidate for a separate Homepage
prototype, not a production-ready replacement. Plain If-Match must not be used as
a safety guarantee. Notes production remains Vercel Blob; no migration/redeploy.

Remaining blockers before a production decision:
- Lock expiry and a paused/crashed writer, token fencing after expiry and reacquire.
- Ambiguous timeout reconciliation and durable client operation receipts; preserve
  local drafts on conflict and errors; offline recovery on iPad.
- Create/delete/move and index consistency under locks, folder/workspace/share ACL
  and revocation,100+ Notes, export/restore and recovery from partial writes.
- Independent measurements from a preview Vercel function and the real iPad path.
- Dedicated server-side credentials for any eventual adapter. Existing backup
  credential remains in this repository only; no browser should receive it.

A subsequent code update can be managed through this GitHub branch and Actions
without user login on every run, while the app password remains valid. Revocation,
account policy or new service authorization can still require user intervention.
For a future deployed adapter, its environment needs one initial secret setup;
no secret will be requested in chat.

Rollback: no deployed Homepage changes exist to undo. Stop opt-in marker runs or
close this draft PR. Retain the isolated synthetic folder for evidence; no broad
cleanup commands. Existing backup workflow files are absent from the PR diff.
No scheduled probe or keepalive task was created.

## Vercel optimization trial (authorized 17/10/2026)

Standalone project homepage-koofr-lab only, no production domain or Git auto-deploy.
Two preview deployments of identical source compare iad1 and fra1; runtime region
must be confirmed in responses. Compare default Node fetch against explicit HTTPS
keep-alive pooling, alternating transport order, keeping all five save requests:
LOCK → GET revision check → PUT(token) → GET byte verification → UNLOCK.
No readback/lock shortcut. Each note is an envelope with revision/body hash and
a bounded8-operation receipt ring. Same base is checked only after acquiring lock.
A lost PUT response is reconciled by exact readback under the same lock; retries
reuse opId. Unknown outcome stays uncertain rather than retrying a write blindly.
These prototype receipts are not a production retention guarantee.

The benchmark runner uses GitHub OIDC signed short-lived tokens. Preview verifies
GitHub JWKS RS256 signature, issuer, audience, repository and ID, exact experiment
branch/workflow, push event, timestamps and run ID before parsing credentials.
Only that Actions job can call it. HTTPS request body carries the existing Koofr
username/app password into Vercel memory for that request, without persisting a
second credential or exposing it to a browser. Entire rclone config and Google
tokens remain in Actions. No passwords/tokens/request bodies are logged.
Preview expires automatically18/10/2026 10:00 Vietnam time; no cron or keepalive.

Each run creates its own Homepage-Notes-Vercel-Probe-<runId>-<UUID> namespace; only
fixed note.json is accessible. Creation refuses an existing folder. No delete or
arbitrary filenames/URLs are accepted. Seed/cycle data is generated server-side.
The new project has route-level authentication; it does not change protection on
Homepage or Home-AI. Health GET is public and has no storage operations.

Pending real measurements. Simulated20/20 pass, including scope/signature rejection,
concurrent same-base write, replay, lost PUT reply, failed readback and failed unlock.
Readback failure cannot become a false verified save; failed unlock retains verified
commit status with a cleanup warning. Lock expiry fencing remains a separate gate.

### Vercel actual result — 17/10/2026

Source4a5a5b2ade3a8c47a44ab74520e74f968b434e4c; runner/workflow
06fdfb0b37dbfccc0b292ca9210f6bbdb9428cc0. Actions run39000235408:
https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/39000235408
Both live region jobs and20 simulated tests passed. Measured actual runtime regions
were iad1 and fra1 (confirmed in each response, not inferred from an intended config).
Deployment IDs/URLs are in docs/results/vercel-deployments-20261017.json. The first
empty lab scaffold was assigned the new lab production alias automatically; the
measurements use two subsequent target=null deployments. Homepage/Home-AI production
were not deployed or modified. No credentials were persisted in the new lab.

Full verified save (all five sequential requests retained), milliseconds:

| Runtime / transport | n | server p50 | server p95 | driver API wall p50 | driver API wall p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| iad1 / default fetch |20|2532|3882|2609|3951|
| iad1 / explicit HTTPS pool |20|1520|1889|1610|1971|
| fra1 / default fetch |20|1416|2039|1622|2232|
| fra1 / explicit HTTPS pool |20|973|1484|1258|1676|

All80 measured saves verified; no failed/timed-out save observed. This small sample
cannot establish a<1% failure probability. p95 is nearest rank19/20, not an SLA.
Two jobs ran concurrently on the same Koofr account with separate namespaces;
provider load and time variance are not isolated. Order alternated each round.
The explicit pool was faster in20/20 paired rounds in iad1 and18/20 in fra1.
Native HTTPS measurements confirmed reused sockets in100/100 benchmark calls per
region. Default Node fetch also has pooling; it was NOT instrumented for socket
reuse, so the speed difference cannot all be attributed to avoiding TLS handshakes.
Transport change includes native HTTP implementation/default headers/pool behavior.

At fra1 explicit pool, mean total1019.26ms is accounted for by phase means:
LOCK46.54ms(4.57%), base GET169.74ms(16.65%), PUT611.44ms(59.99%),
readback181.15ms(17.77%), UNLOCK10.18ms(1.00%), other0.22ms(0.02%).
These shares use means (sum is valid), not sums of independent medians. Individual
TTFB/socket timings are retained in the raw sanitized results. PUT includes network
and remote processing; we cannot split Koofr internals from external observations.
Verified read p50 is148ms at fra1 pooled versus299ms at iad1 pooled.

Correctness exercised on the actual Vercel path:
- Five concurrent same-base pairs per region: exactly one verified commit; the
  other busy423 or conflict409. Losing editor reacquired and got conflict409.
- Retried winning operation returned its receipt without increasing revision.
- An explicitly stale base was rejected409 without a PUT.
- Final revision45 in each namespace:40 measured commits +5 race winners.
- Anonymous POST denied401 before credentials/storage operations.
- No unresolved lock-release warnings or observed ambiguous writes.
Actual network interruption, expiry and crash recovery were NOT injected; ambiguous
PUT/readback/unlock failures are simulated tests only.

Raw sanitized request/phase measurements are committed (not just seven-day artifacts):
- docs/results/vercel-koofr-iad1-20261017.json (104 API samples)
- docs/results/vercel-koofr-fra1-20261017.json (104 API samples)
- docs/results/vercel-koofr-summary-20261017.json (summary and complete phase accounting)
Artifacts12088987013(iad1) and12088098914(fra1) are the original formatted reports.

Decision: select fra1 + explicit bounded HTTPS agent as the next prototype candidate.
No lock or verification roundtrip was removed. Against the same-run iad1/fetch
control, server median falls61.6%; same-region fra1 transport comparison falls31.3%.
This is evidence of improvement, not of production readiness or Keep-like iPad UX.
These are Vercel→Koofr saves and GitHub-driver→Vercel→Koofr wall times; no iPad/company
network, offline editing, full UI, 100-Note indexing, ACL/revocation or restore benchmark
has been run. Health was called before seed and timed samples, so cold-start/idle
performance remains unmeasured. Existing Notes production remains private Blob.

### Repeat/update and rollback

No new account setup was needed. Update this branch through GitHub; deploy only
experiments/vercel-koofr-lab source to the dedicated lab with the Vercel connector.
Set the LAB project's resourceConfig.functionDefaultRegions before deploying each
region; deployment settings alone did not change the actual runtime in this trial.
Use the resulting immutable preview URLs in scripts/koofr_vercel_bench.mjs and a
commit containing [vercel-koofr-bench] to opt in to the bounded matrix run. The OIDC
identity is locked to this workflow and branch. Normal docs/code commits do not
run live measurements. Expiry is explicit in api/bench.js; extending it is a source
change/deployment, never automatic. No Vercel API token/Koofr password is added to
GitHub source. The existing RCLONE_CONFIG_CONTENT secret stays in the backup repo;
only Koofr username/password go to Vercel memory over HTTPS while running.

Rollback/stop: leave production untouched and stop marker runs. After the explicit
expiry, every benchmark POST returns410 before authentication or storage access.
Optionally remove only the dedicated lab deployments/project using its recorded ID;
do not delete Homepage/Home-AI or change their domains. Retain the two synthetic
folders as evidence; no real-data cleanup/migration/backup changes are part of this PR.

## Resilience follow-up

The later bounded expiry, controlled TLS fault and one-note recovery trial is
documented in KOOFR-RESILIENCE-20261017.md. All three groups now have passing live
evidence; the first expiry fixture failure is retained separately.29 simulated
tests pass. This supersedes the initial statement that expiry and controlled
transport faults are untested, while full-store/ACL/iPad/idle gates remain open.

##100-Note/folder/share follow-up

See KOOFR-STORE100-20261017.md: full live100-Note trial and104-record restore passed
after replacing parallel inherited-lock requests with a per-session single-socket
agent. Full backend save p50=2093ms, p95/max=5296ms(n15); the primitive973ms number
does not represent this complete architecture.43 simulations and a separate narrow
late-restore guard live recheck pass. Production/session/UI/large-note/search gates
remain open; no cutover or migration occurred.
