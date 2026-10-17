# Koofr / Vercel isolated prototype

Production Notes remains Vercel Blob. No Homepage/Home-AI deployment, main merge,
real Notes migration, existing backup workflow or NAS/report/GAS changes.

**Actual full-store trial passed:**100 original Notes read/verified, folders,
checklists/history, note/folder share isolation and revoke, independent TLS-session
same-base race, expired/revoked writer fencing, and104-record full restore
(100 active +4 tombstones).43 simulations pass. A separate two-Note live follow-up
verified incomplete restore and late chunk retry guards.

Full backend save p50=2093ms, p95/max=5296ms (n15 committed saves in one functional
run). Earlier973ms was a different single-Note primitive; do not use it as the
full backend benchmark. No iPad/browser/public URL end-to-end or SLA claim.

Start with ../../docs/KOOFR-STORE100-20261017.md for schema, tradeoffs, failed runs,
correction, exact live evidence and remaining gates. Earlier primitive performance:
../../docs/HOMEPAGE-KOOFR-WEBDAV-20261017.md; socket faults/expiry:
../../docs/KOOFR-RESILIENCE-20261017.md.

- lib/store.mjs: immutable revision per Note + small catalog commit point,
  inherited collection fencing, capability service, folders, receipts/tombstones.
- lib/store-backup.mjs: integrity-checked snapshot, new-epoch restore, old links
  revoked, partial restore hidden and late retry blocked after newer edits.
- lib/store-fixtures.mjs: OIDC-only synthetic tests; no generic public Notes API.
- Each store session MUST keep maxSockets=1: real inherited-lock writes failed
  on parallel sockets. Do not remove this workaround without repeating tests.
- lib/storage.mjs / resilience.mjs: original primitive and internal fault hooks.
- api/bench.js / oidc.mjs: exact GitHub repo/branch/workflow identity, bounded paths,
  metadata-only logs, no persisted account secret. POST expires18 October10:00 VN.

Run simulations from repo root:
`node --test experiments/vercel-koofr-lab/test/*.test.mjs test/koofr_webdav*.test.mjs`
Node24, no dependencies. Live jobs are marker-opt-in, not scheduled.

Prototype limits:128 synthetic slots,28KB serialized Note value vs current app's
1MB content/3MB record; no full-text search, production session/CSRF adapter, UI,
client busy retry/offline draft handling, independent backup retention, orphan GC,
or sustained/cold/reconnect/separate-invocation benchmarks. Backups are on the same
Koofr account; hashes detect accidental corruption, not malicious rewriting.
