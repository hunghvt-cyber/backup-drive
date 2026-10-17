# Koofr / Vercel isolated prototype

Production Notes remains Vercel Blob. No production adapter, migration, UI or
backup/report change is included here. Do not merge/deploy into Homepage/Home-AI.

Measured on17 October2026:80/80 verified saves;10/10 lock races;20/20 simulated
tests. Frankfurt + explicit native HTTPS pool: n20, server p50=973ms, p95=1484ms;
GitHub-driver API wall p50=1258ms, p95=1676ms. All five save requests are retained.
Source/methodology/raw evidence: ../../docs/HOMEPAGE-KOOFR-WEBDAV-20261017.md.

- lib/storage.mjs: fixed synthetic path, LOCK/base revision/PUT/readback/UNLOCK;
  op receipts/replay; ambiguous PUT read reconciliation; fail-closed conflicts.
- lib/oidc.mjs: GitHub Actions signed OIDC identity, exact repo/branch/workflow.
- api/bench.js: bounded POST benchmark, sanitized metadata log/request ID, no secret
  environment variables or persistent credential storage. Auto-expires18 October
  at10:00 Vietnam time. Public GET health has no storage access.
- vercel.json: Frankfurt candidate. Also set the dedicated project's resourceConfig
  functionDefaultRegions to fra1; verify region in responses after deployment.
- ../../scripts/koofr_vercel_bench.mjs and workflow koofr-vercel-bench.yml: opt-in
  measured runs using the existing Koofr connection in the backup repository.

Run simulation: node --test experiments/vercel-koofr-lab/test/*.test.mjs
(from repository root). Node24, no dependencies to install. Live run instructions,
immutable preview URLs, credential flow and rollback are in the report above.

Not yet verified: lock expiry/crash fencing, actual network outages, idle/cold start,
100+ Note index/ACL/share revocation, restore, browser/offline draft safety and the
actual iPad/company network. Receipt ring is bounded8 and is not indefinite
idempotency/history. Prototype improvement is not authorization for production.

Resilience follow-up:29 simulation tests passed; live corrected expiry/token
fencing, six controlled TLS faults and byte-exact one-Note restore passed. See
../../docs/KOOFR-RESILIENCE-20261017.md for both the initial failed fixture and
corrected recheck evidence. Full-store/iPad/ACL gates remain open.
