# Koofr/Vercel resilience trial — 17 October 2026

Authorized scope: lock expiry, controlled connection failure and recovery using
synthetic data only. Notes production stays Vercel Blob. No main merge, Homepage
redeploy, backup workflow change, NAS calls or real data migration/deletion.
Dedicated Vercel project homepage-koofr-lab, Frankfurt, existing GitHub OIDC and
Koofr connection; no new credentials or browser exposure.

## Method

Three independent fresh Homepage-Notes-Vercel-Probe-<runId>-<UUID> namespaces:

1. **Expiry:** request exclusive lock A for5 seconds, confirm contender423, then
   poll for a new lock B without UNLOCK or refresh of A. Maximum observation75s;
   no assumption that a requested Timeout is honored. Acquire B with a different
   token, write/verify a new revision, reject A's writes both while B is held and
   after B is released. A's UNLOCK must not remove B. Paused editor must recheck
   its old base revision under a newly acquired lock and receive conflict409.
   A successful server-side acquisition, not the client clock, proves expiry.
   If expiry is not observed, report a failed/unverified gate and clean up only
   our own known token; do not claim a short lease works.
2. **Controlled TLS faults on the real Vercel→Koofr path:** explicitly destroy the
   HTTPS request/socket before sending PUT; after receiving PUT response headers;
   after receiving readback headers; for both PUT and reconciliation GET; before
   UNLOCK; after UNLOCK headers. Record exact injection points/statuses, no raw
   headers or tokens. This is deliberate connection fault injection, NOT evidence
   of a naturally occurring provider outage or the iPad going offline.
   Retry the exact same opId/base revision; require exactly one new revision.
   Unknown outcome must stay unconfirmed; a verified write with failed unlock
   retains committed status plus a cleanup warning. If the unlock request is
   dropped, observe busy423 and release only that known own token as recovery.
   After receipt eviction, an old base must conflict without another PUT.
3. **Recovery:** export one synthetic Note envelope into a durable backup.json
   file; verify byte hash and readback. Advance its source, deliberately corrupt
   that synthetic source under a lock, require normal writes to fail closed.
   Reject a deliberately corrupted backup before import. Read the valid backup
   again from Koofr and restore to a previously absent recovered.json (new file
   identity). Drop its PUT response through an actual socket destruction; reconcile
   by GET/hash, not a second PUT. Keep the corrupted source for evidence.

Recovery restores exactly one Note envelope (Unicode/checklist/body/revision/
receipt ring). It is NOT a100-Note full-store restore, production backup policy,
folder/workspace/ACL/share revocation restore or in-place revision rollback.
The checksum detects accidental corruption, not maliciously rewritten backups.
Both backup and recovered files live in the same provider: not disaster recovery
from loss of the Koofr account. A separately protected export remains necessary.

## Implementation/verification

lib/resilience.mjs orchestrates the cases; nativeTransport adds internal-only
fault hooks. The public route accepts only the three fixed test modes after the
existing OIDC checks. It cannot select arbitrary hosts or file paths. The normal
save path does not enable fault injection. POST still auto-expires18 October
10:00 Vietnam time. No scheduled run or real-data cleanup.

During simulation, cumulative instrumentation was corrected: when reusing a DAV
client, operate() now returns only calls belonging to its own operation; the DAV
client can retain aggregate calls for the whole test. This does not change the
save protocol or the already recorded benchmark (one DAV client per API request).

28 simulated tests passed before deployment, including broken expiry/fencing
servers and faults that never actually execute (which must fail the test gate).
No simulated duration is presented as a real provider lease or benchmark.

## Live result

Pending actual isolated Vercel/Koofr run. Do not infer success from simulation.

Protocol reference: https://www.rfc-editor.org/rfc/rfc4918.html sections6.6,7.7,9.10.
Server chooses the lease duration; a client clock/Timeout request is not proof that
a lock has been removed. The test therefore observes new lock acquisition and
actual rejection of the expired token instead of relying on the requested5s.

### Initial live run and narrow recheck

Run39001007775, sourcea410f754, driver9bd70ec7, artifact12089380732.
Six live controlled TLS fault cases passed; final revision15 after6 fault-case
commits +9 receipt-eviction setup saves. Old evicted request failed409 without PUT.
One-note durable backup/restore passed, byte hashes match, restored2307 bytes,
exactly one restore PUT despite its destroyed response socket.

Expiry was observed without UNLOCK and stale A write returned412 while B was held.
Expired A UNLOCK409 did not remove B (contender423, content preserved). The test
then failed UNLOCK_FAILED: B had also been requested for only5s and its validation
sequence consumed about4.8s; B's UNLOCK and cleanup returned409. This is an overly
short successor lease in the test, not proof that Koofr violated exclusion. The
original failed report is retained with its conservative outstanding-lock warning:
docs/results/vercel-koofr-resilience-initial-20261017.json.

A narrow recheck requests A5s but B60s, confirms B's advertised lease and records
the interval before its UNLOCK. A slow-call simulation regression was added.
29 simulated tests pass. Only expiry is rerun; the passing fault/restore cases are
not repeated. Until recheck evidence exists, expiry remains an incomplete gate.

### Final live expiry recheck — PASSED

Sourceff2244f590362b5eadbdf177211c207d0da52bbe; driver/workflow
b7bb749521a77c03b17e061effb47cd252b01066. Run39001279740:
https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/39001279740
Vercel previewdpl_2esQBipQVaY5axo4QkjvKTvensFP, actual regionfra1. Artifact12089096881;
committed raw evidence docs/results/vercel-koofr-expiry-recheck-20261017.json.

| Gate | Actual observation |
| --- | --- |
| A expires without UNLOCK/refresh | Requested/advertised Second-5; contender first423, acquired a new token after6049ms of polling observation |
| Successor B lease | Advertised Second-60; validation held it for7765ms before successful UNLOCK |
| Expired A PUT while B owns file |412; B content preserved |
| Expired A UNLOCK |409; B remained held, competing LOCK423 |
| Expired A PUT after B release |412; content preserved |
| Paused editor retries stale base |409 conflict, no overwrite |
| Final new test lock cleanup | No active own token / no outstanding-lock warning |

The initial failure was the test requesting only5s for B as well. The recheck's
7765ms successor validation exceeds that old fixture lease, confirming why a
longer successor lease is necessary. Do not erase or reinterpret the failed run
as a pass: the final expiry gate is supported by the separate corrected run.

The historical initial warning was separately reconciled from the GitHub runner
against ONLY its exact retained synthetic namespace
Homepage-Notes-Vercel-Probe-39001007775-1e85a400-cb73-44bb-906a-55ea272dce35:
LOCK200 acquired a fresh token, UNLOCK204 released that same new token. No content
write/delete, unknown-token unlock or backup path access. This confirms the old
short-lived lock was not still present at that check; it does not change history.

### Combined decision / limits

All three bounded groups now have actual passing evidence: corrected expiry,
six controlled TLS-fault cases, and one-note durable backup/restore.29 simulated
tests pass, including successor validation slower than the initial5s fixture.
Controlled transport faults included7 actual socket destructions across6 cases;
restoration added one. No naturally occurring Internet failure was induced or
observed; no iPad network/IndexedDB recovery or literal process-kill test was run.

The restore preserved exact2307-byte Note envelope, SHA256
7e20ed6f34e79b74c42e6c14ddf5f504273960a307d572a9fc5aa05014be77da,
in a NEW identity. Source corruption and backup tampering were rejected, and the
restore required only one PUT after its response was discarded. Normal writes
cannot repair malformed records automatically or silently overwrite them.

This resolves specific protocol/reconciliation/recovery questions, not production
readiness. Remaining gates:100+ Notes and complete app schema, folder/workspace
consistency, share ACL/revocation, independent backup retention/restore of the
whole store, cold starts/idle/soak, real iPad offline drafts and ambiguous user
requests. Koofr WebDAV still ignores HTTP If-Match; never remove lock-token fencing.
Finite receipt history is not indefinite replay confirmation: old evicted retries
fail conflict and require reconciliation without silently committing again.

### Repeat / stop

All source and reports are in the existing isolated branch/draft PR. The existing
workflow accepts [vercel-koofr-resilience] for all3 groups or
[vercel-koofr-expiry-recheck] for expiry plus exact historical-lock reconciliation.
For a deliberate future run, deploy updated lab source, use its immutable URL in
the runner, and review the explicit API expiry. No new secret setup is needed while
existing connected permissions remain valid. No recurring Actions job was added.
The benchmark route stops POST at18 October2026 10:00 Vietnam time automatically.

No production rollback needed: no Homepage/Home-AI deployment, main merge, Notes
migration, GAS/report change or backup workflow modification occurred. Keep the
synthetic namespaces for evidence; the only deliberately corrupted file is inside
the private test namespace, with its matching backup and recovered copy retained.
