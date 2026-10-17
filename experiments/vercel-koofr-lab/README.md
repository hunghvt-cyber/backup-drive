# Latest restore/API preview preparation

New source8e4d4af3 fixes empty/resumable restore and adds a synthetic-only session/CSRF/share
HTTP adapter using iron-session8.0.4. UUID Notes and1MB content/3MB serialized values
replace the former128-slot/28KB save ceiling. Catalog240KB and snapshot export2MB remain.

**85 LOCAL simulations/HTTP tests pass.** Current Actions run39022865357 failed before
runner steps on both attempts; live qualification was skipped. Earlier live results
below tested earlier code and do not validate the new head. Independently verified
standalone HTTPS: health200 configured=false; Notes/auth503 closed. User-facing HTTPS
login/CRUD and new live restore regression are pending.

Start with ../../docs/KOOFR-API-PREVIEW-20261017.md for exact status, contracts,
configuration, evidence and the startup-error account action. No production change.

Run `npm ci --ignore-scripts --no-audit --no-fund --prefix experiments/vercel-koofr-lab`
from repo root before the test command below; the pinned session library is now required.

---

# Koofr / Vercel isolated prototype

Production Notes remains Vercel Blob. No Homepage/Home-AI deployment, main merge,
real Notes migration, existing backup workflow or NAS/report/GAS changes.

**Actual full-store trial passed:**100 original Notes read/verified, folders,
checklists/history, note/folder share isolation and revoke, independent TLS-session
same-base race, expired/revoked writer fencing, and104-record full restore
(100 active +4 tombstones).59 simulations pass, including the new full-store reliability fixtures. A separate two-Note live follow-up
verified incomplete restore and late chunk retry guards.

Full backend save p50=2093ms, p95/max=5296ms (n15 committed saves in one functional
run). Earlier973ms was a different single-Note primitive; do not use it as the
full backend benchmark. No iPad/browser/public URL end-to-end or SLA claim.

Latest:13 full-store socket fault cases and100 cross-preview race pairs passed,
697 independent invocations,150 new writes/150 cross-preview replays, final100
records verified. See ../../docs/KOOFR-RELIABILITY-20261017.md. This is a bounded
functional pass, not production readiness.

Start with ../../docs/KOOFR-STORE100-20261017.md for schema, tradeoffs, failed runs,
correction, exact live evidence and remaining gates. Earlier primitive performance:
../../docs/HOMEPAGE-KOOFR-WEBDAV-20261017.md; socket faults/expiry:
../../docs/KOOFR-RESILIENCE-20261017.md.

- lib/store.mjs: immutable revision per Note + small catalog commit point,
  inherited collection fencing, capability service, folders, receipts/tombstones.
- lib/store-backup.mjs: integrity-checked snapshot, new-epoch restore, old links
  revoked, partial restore hidden and late retry blocked after newer edits.
- lib/store-fixtures.mjs: OIDC-only synthetic tests; no generic public Notes API.
- lib/store-reliability.mjs: 13 full-store TLS fault/replacement cases, independent
  invocation race/replay and expired shared-writer publication checks.
  Live methodology/results: ../../docs/KOOFR-RELIABILITY-20261017.md.
- Future Note reordering idea (deferred): ../../docs/NOTES-IDEAS.md.
- Each store session MUST keep maxSockets=1: real inherited-lock writes failed
  on parallel sockets. Do not remove this workaround without repeating tests.
- lib/storage.mjs / resilience.mjs: original primitive and internal fault hooks.
- api/bench.js / oidc.mjs: exact GitHub repo/branch/workflow identity, bounded paths,
  metadata-only logs, no persisted account secret. POST expires18 October10:00 VN.

Run simulations from repo root:
`node --test experiments/vercel-koofr-lab/test/*.test.mjs test/koofr_webdav*.test.mjs`
Node24, no dependencies. Live jobs are marker-opt-in, not scheduled.

Earlier baseline limits (superseded by new source above):128 synthetic slots,28KB
serialized Note value. Remaining gates: no full-text search, production session/CSRF adapter, UI,
client busy retry/offline draft handling, independent backup retention, orphan GC,
or sustained/cold performance benchmarks. Reconnect/separate-invocation functional
qualification has its own evidence/report above; do not infer long-outage or
process-kill recovery from it. Backups are on the same
Koofr account; hashes detect accidental corruption, not malicious rewriting.
