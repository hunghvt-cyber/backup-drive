# Notes API preview / restore fixes — 17 October 2026

**Status:85 local simulations/HTTP checks pass; current live requalification blocked before runner steps. Not production-ready.** Production Notes
stays on Vercel Blob. Only dedicated lab preview and fresh synthetic namespaces.
No Homepage/Home-AI/main deployment or UI change, real Notes migration, NAS/GAS/report
operation, Blob deletion or existing backup-workflow modification.

## Restore fixes

Empty snapshots finish immediately (`restoring=false`). Repeated initialization and
empty chunk0 replay are read-only and preserve the new epoch.

A new root receives `restore-control.json` under its inherited collection lock.
The marker binds the restore to the exact snapshot SHA256 and source epoch. A retry
may initialize an existing root ONLY when its marker matches. If the initial catalog
was already written, retry returns its current progress without resetting entries,
folders, revoked links, epoch or later edits. Every restore chunk verifies the same
snapshot fingerprint, preventing a replacement backup with the same source epoch
from silently mixing records. Existing late-chunk guards still apply.

The marker and initial catalog use token-fenced PUT and readback. Lost responses are
reconciled or left unconfirmed, and a later initialization resumes from the marker.
A pre-existing normal root without the marker is refused409 without content PUT.

**Earliest ambiguous creation:** if MKCOL applied but its response was lost BEFORE
an ownership marker could be written, the caller cannot prove that existing root
belongs to its restore. The implementation refuses409 RESTORE_RESERVATION_MISSING;
choose a new random synthetic target and retry. It never adopts/clears an unmarked
root. That tiny window is safe restart-to-new-target, not automatic same-target
recovery. Unknown/corrupt markers also fail closed; no data deletion is attempted.

Snapshot exports retain a2MB ceiling and now reject oversize payloads BEFORE writing
an unreadable backup. Chunked/independent backup retention is still a release gate.

## API prepared

`api/preview.js` routes a Web Request handler via `?route=...`, separately from all
Homepage production URLs. Default configuration closes storage routes with503;
health only exposes configured=true/false, no account or namespace details.
A Production environment or a different known project ID is refused. Even enabled
configuration accepts ONLY a synthetic `Homepage-Notes-Vercel-Probe-<run>-<uuid>` root.

| route | Methods | Behavior |
| --- | --- | --- |
| health |GET|Public minimal readiness; no storage call|
| auth |GET/POST/DELETE|Session check, password login, local logout|
| notes |GET/POST|List/delta, detail/notModified; save/delete/folderDelete|
| notes-save |POST|Save with clientOpId and base revision|
| folders |GET/POST|Owner list and create|
| note-share |GET/POST|Owner link metadata, create edit/view link, revoke|
| shared-note |GET/POST|Read/edit through a live note capability|
| shared-folder |GET/POST|List/read/create/edit only in its live folder scope|

Owner login uses the same pinned iron-session8.0.4 library as Homepage, with a
DIFFERENT host-only Secure/HttpOnly/SameSite=Lax cookie. Password changes invalidate
old sessions; sessions are bound to the configured synthetic namespace. The password
attempt limiter is stored in the catalog under the provider lock (global30/per-IP5
per15-minute bucket), so counters are shared by function instances. Logout clears
the current cookie; it does not remotely revoke another stolen valid cookie.

All mutations require exact configured Origin, JSON and no cross-site Fetch Metadata.
Private responses use no-store/nosniff/no-referrer. Do not assume older immutable
preview URLs receive changed config automatically; restrict/retire older configured
previews and verify password revocation across deployed URLs before any browser pilot. Public share API capability is
passed in Authorization:Bearer, never a logged API query parameter. A public Note
response excludes history/folder/pin. Owner cookie presence cannot escalate a share
request. Revoked capability is checked before a retry receipt. Public HTML share UI
and its token handling remain to be integrated; existing production links are unchanged.

Save requires a stable UUID `clientOpId`, reused with the SAME payload/base across
retries. If creating without an id, Note id=clientOpId so a retried request cannot
allocate a second Note. Real UUID IDs and UUID revision filenames are now supported;
legacy numeric synthetic fixtures remain compatible. Owner can create a folder while
saving. Content limits now match the current app:1MB combined text/checklist,3MB
serialized value (old history trimmed if necessary),3.1MB bounded record reads.
Catalog is still bounded to240KB publication/256KB read; UUID support does not imply
unbounded capacity. Actual legal-limit payloads need additional live size benchmarking.

A replay acknowledgement can reference an older commit while a later edit is live.
The response supplies live content/revision AND `acknowledgedRevision` for the retried
operation; it never labels older content with the new revision. If post-save readback
fails, HTTP503 remains unconfirmed and the same op ID is retained for retry.

HTTP423 supplies Retry-After; HTTP409 preserves the draft. No automatic retry changes
the base revision or falls back to Blob. Share creation is NOT receipt-idempotent yet:
a lost response may leave an unused active link. The owner can list/revoke it; do not
blindly auto-retry share creation. Folder deletion is atomic in the catalog.

## Explicit contract gaps before Homepage UI integration

- List remains100-character preview with `previewOnly:true` and
  `fullTextSearchAvailable:false`; it is not the current full-text/checklist search.
- Client must attach stable op IDs and revisions, including delete. Current Homepage
  delete accepts acting on latest server copy; preview requires a base revision.
- Shared capability moves to Authorization, and routes currently use a preview prefix.
- Browser durable drafts/outbox, independent backups, catalog corruption recovery,
  full schema validation, capacity/retention and durable log/alert retention remain.
- No physical process-kill, prolonged outage or production cutover is implied.

## Evidence and testing boundaries

85 simulations include real local HTTP server roundtrips to the adapter with an
in-memory provider, cookie tampering/rotation/logout, Origin/JSON rejection, durable
login limits, UUID/>28KB Unicode, conditional reads/delta, stale conflict, idempotent
retry, note/folder share view/edit/revoke, plus previous100-Note and transport suites.

The live qualification uses the existing Actions Koofr connection. Restore faults
really destroy HTTPS requests; adapter contract requests execute the SAME Web Request
handler inside the OIDC fixture against real Koofr, with temporary synthetic auth keys.
This is NOT a signed-in browser calling the standalone route. Genuine HTTP smoke tests
of that standalone route check health and refusal while permanent credentials are
absent. Do not claim the user-facing HTTPS login flow is live until configured and
separately verified. The driver also repeats the complete100-Note/104-record restore
regression after the backend changes.

Deployed source8e4d4af3; previewdpl_EzLBLjkgH3d4SnV8QoMBrtM2rZ4U:
https://homepage-koofr-6e6rdsffp-hunghvt.vercel.app/api/preview?route=health
Driverf27c292a; [run39022865357](https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/39022865357) failed before any simulation step in BOTH attempts. GitHub returned no steps and no job log. Its dependent live job was skipped, so no new Koofr qualification ran. The connector returned two annotation counts but could not fetch their text; the startup restriction has now been confirmed by the account owner (see update below). Do not assume a code/test failure or claim current CI passed85 tests.

Standalone HTTPS smoke from the workspace separately verified health200 configured=false, owner notes503 and auth503. Evidence: [closed HTTP smoke](results/koofr-preview-http-closed-20261017.json), [local85-test summary](results/koofr-preview-simulation-20261017.json). These do not establish current live restore/CRUD behavior. Earlier live results in KOOFR-RELIABILITY-20261017.md tested source1245e4c2, not this new source.

Next account action: open the Actions run above, select the failed simulation job, and read its startup error/Annotations banner. The account owner must provide that NON-SECRET error text or resolve the indicated runner/account restriction before the existing-credential live test can proceed. No payment, spending-limit or account change is authorized or performed. Do not repeatedly queue doomed reruns; only one retry was attempted.

## One-time configuration for an independently callable preview

Use ONLY the `homepage-koofr-lab` project's **Preview** environment. No secret in chat,
GitHub source, browser JavaScript or a public URL. Example keys are in
`experiments/vercel-koofr-lab/.env.preview.example` (blank placeholders).

Configuration can be split once: the agent prepares enable flag, synthetic root and
a fresh session encryption secret; the account owner enters Koofr user/app password
and the preview login password DIRECTLY in Vercel's Environment Variables UI. Existing
GitHub Actions credentials allow tests, but are not automatically exposed to a Vercel
runtime. Do not retrieve or print the existing secret to bridge the two projects.
Use at least12 characters for the preview login password and32 for the session secret.
The specific fresh root will be recorded by the live qualification; no existing backup
folder may be used. A new preview deployment is needed to receive changed variables.

When a stable preview alias is chosen, configure PREVIEW_BASE_URL to that exact HTTPS
origin; otherwise the immutable Vercel URL supplies the origin. No wildcard Origin.
Before enabling browser testing, recheck unauthenticated401, login cookie, CSRF403,
owner CRUD, shared view/edit/revoke and unavailable-provider draft preservation through
that deployed HTTPS endpoint. This configuration/verification is still pending.

Rollback for this experiment: stop marker-opt-in jobs and leave preview disabled.
Nothing needs rolling back on Homepage/Blob. Keep trial namespaces/evidence for review.

## Owner-confirmed startup blocker —17:16 Vietnam time

The account owner supplied GitHub's error: runner startup was refused because recent
account payments failed OR the spending limit needs increasing. This confirms a
billing/spending restriction, not a test assertion failure. The exact billing branch
has not been independently distinguished. The Ubuntu26 label-migration notice is
informational and did not cause this startup refusal.

Stop automatic/manual retry attempts until the owner resolves the applicable account
restriction in Billing & plans. No paid upgrade, spending-limit increase, payment
change or runner migration is authorized/performed. New live Koofr qualification
remains pending;85 local checks and the closed HTTPS smoke remain valid evidence.
