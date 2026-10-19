# Full-store reconnect / independent Vercel invocation trial — 17 October 2026

**Status: bounded full-store live trial PASSED. Not production-ready.**
Production Notes remains private Vercel Blob. No Homepage/Home-AI deploy, migration,
NAS access, GAS/report change or existing backup-workflow edit. UI integration deferred.

## Method and scope

A fresh synthetic root is seeded with 100 distinct immutable Note records and the
same catalog/ACL/revision backend used by the previous full-store trial. No primitive
single-note replacement is substituted. The backend implementation `store.mjs` is
unchanged; only bounded fixtures, telemetry and a driver were added.

Two immutable previews of the SAME source run in the dedicated homepage-koofr-lab
project, reported VERCEL_REGION checked at runtime. Requests alternate/collide across both
previews against the SAME new synthetic store. Request UUIDs and module-runtime UUIDs
are retained to distinguish real HTTP invocations from two clients inside one handler.
Distinct deployments provide separate runtime contexts; this is not a cross-region
soak, forced physical host separation or a literal process-kill test.

- Deployed source: `1245e4c27bebbe1960ab0494a7e34fd09c44d786`.
- Preview A: `dpl_mrCmHu8KPKKf5a5i1Q23AXNaGR1x`, homepage-koofr-2i5e7wjjx-hunghvt.vercel.app.
- Preview B: `dpl_FztSSFaAZYbY76WKQL5znRx6hiy3`, homepage-koofr-92oxf6bgh-hunghvt.vercel.app.
- Both verified READY, target=null, project `prj_ZJDuwQOKVSzqfs3z0IMLAOrlNudX`, fra1.
- Driver: `8104cdf09b8059b20d136f0ace4960ccdef20fe5`.
- [Live run 39020640005](https://github.com/hunghvt-cyber/my-backup-gdrive-koofr/actions/runs/39020640005).

## Fault cases (deliberate real TLS socket manipulation)

13 cases: discard LOCK reply; discard catalog base read; fail before immutable PUT;
discard immutable PUT reply; discard immutable verification; fail before catalog
publish; discard publish reply; discard publish verification; discard both publish
and reconciliation; fail before UNLOCK; discard UNLOCK reply; force a new connection
after successful base read; force a new connection after immutable verification.

Native HTTPS requests are destroyed before send or on actual response headers; the
two connection-replacement cases destroy the session agent after a successful response
and require the next request to report a fresh socket. Credentials and lock headers
stay in memory. These controlled failures are not naturally occurring provider outage,
iPad offline, request cancellation or killing a Vercel process.

Each case checks live catalog HEAD/version/content, never infers commit from an HTTP
error. A retained draft retries with identical op ID/base on a new session, then
replays again; expected result is exactly one publication. Lost LOCK/UNLOCK cases
use a 15s lease, observe BUSY and wait 16s before recovery; other cases use 60s.
A catalog publication whose verification/reconciliation is unavailable must remain
unconfirmed even if the actual file committed. Orphans must stay unreferenced until
a verified retry publishes them. No blind unconditional PUT fallback is allowed.

## Cross-preview cases

50 same-note pairs: both start from the same base revision; one commits, the other
may initially receive BUSY but must ultimately conflict409 with that original base.
50 different-note pairs: the global catalog lock may queue/reject BUSY; bounded
client retry must preserve both independent writes. Winner replays are sent to the
opposite preview with the SAME op ID and base to verify cross-process idempotency.

The driver keeps every initial BUSY and retry invocation, uses bounded backoff (75s
maximum), and measures complete pair wall time including recovery and verification.
The retry loop is fixture-driver behavior, not an implemented Homepage client queue.

A separate shared writer creates an immutable orphan under a 5s lease then pauses.
The other preview observes that orphan, waits/retries for the expired root lock and
commits revocation. The stale writer must fail catalog publication; its retry using
the revoked link must be denied before replay. Finally all 100 records are hash/ID
validated and active count checked. Link tokens are returned privately to the runner
once and stripped before reports/artifacts/logs.

## Simulation and setup failures

59 simulations passed locally and in CI for the first driver run, including 13 full
store fault cases, a negative check that refuses a missing injection, invocation
race checks, and expiry/revoke fencing. Simulation uses an in-memory fake provider.

The first packaging omitted a static public page, causing two preview builds to
fail STATIC_BUILD_EMPTY_OUT_DIR. Run39012800853 then failed before any authenticated
POST or synthetic Note creation (0 invocations/0 cases). This is a setup failure,
not evidence about Koofr reliability. Added a tracked static lab page and verified
both corrected previews READY before triggering the new live run.

## Results / interpretation

Run39020640005 completed successfully. All 13 fault cases passed (14 actual transport
injections, because one case drops both publish and reconciliation). Both deliberate
connection replacements observed a fresh next socket and successfully committed.
A socket replacement therefore worked in these two sequential full-store cases;
this does not justify removing the maxSockets=1 serialization workaround.

| Check | Observed |
| --- | --- |
| Full-store fault/retry cases |13/13 passed|
| Same-Note same-base pairs across previews |50/50: one200, other409 after bounded BUSY retry|
| Different-Note pairs across previews |50/50: both writes preserved|
| Newly published race saves / opposite-preview receipt replays |150 /150|
| Separate HTTP invocations |697, all request UUIDs unique|
| Module runtime contexts |2, exactly one observed per preview; A288 requests, B409|
| Driver-recorded BUSY outcomes |104:100 race write attempts +4 revoke attempts|
| Shared writer after expiry / owner revocation |Publication409; revoked retry403; orphan ignored|
| Final integrity |All100 immutable records read with hash/ID validation;100 active|
| Unexpected cleanup warnings outside fault cases |0|

Two cleanup warnings were intentional: dropped UNLOCK request and dropped UNLOCK
reply. The first observed BUSY then recovered after its15s lease; the second had
already released the provider lock but correctly reported an unverified response.
Lost LOCK reply also recovered after an observed BUSY/lease expiry. Unknown publish
outcomes were not falsely confirmed; retry used the same op ID/base and published
once or replayed the receipt. Failed pre-publication attempts did not expose orphans.

Owner revocation in preview B completed before the paused writer in A returned its
fenced publication failure (report request completion indices693 then694). The final
verification denied the revoked retry before replay and confirmed Note HEAD unchanged.

The controller returns a200 test envelope for an expected409/423/503 outcome that
its assertions validate. All697 envelopes passed; that is NOT697 successful CRUD
operations or an availability percentage. Expected internal errors are in metrics.

### Timing, including contention

| Measurement | n | p50 ms | p95 ms | max ms |
| --- | ---: | ---: | ---: | ---: |
| Newly published race saves, server service duration |150|2176|4799|7728|
| Same-Note pair end-to-end validation wall time |50|4659|6227|7654|
| Different-Note pair end-to-end validation wall time |50|8242|11208|14161|

Pair time includes competing attempts, BUSY retry, readback and cross-preview receipt
replay; it is not the latency of a single user save. Published-save rows exclude
BUSY/409/replays, while every attempt remains in the raw report and pair wall time.
These are functional stress checks, not randomized production benchmarks. Final
100-record integrity scan took25.65s as one fixture stage; provider latency varies.
Do not substitute either this value or the earlier primitive973ms for iPad UX.

### Durable evidence

- Original Actions artifact12096518104 (seven-day retention); durable raw report:
  [koofr-store-reliability-live-20261017.json.gz](results/koofr-store-reliability-live-20261017.json.gz).
- [Readable summary](results/koofr-store-reliability-summary-20261017.json), including
  raw/gzip SHA256 hashes and exact endpoint/runtime counts.
- Original raw JSON1,965,532bytes; gzip188,231bytes. Use `gzip -dc` to inspect.
- [Simulation summary](results/koofr-reliability-simulation-20261017.json):59/59,
  CI job117361578178; these tests used a fake provider, unlike the live run.
- [Setup failure](results/koofr-reliability-setup-failed-20261017.json), run39012800853,
  artifact12093761178; retained separately instead of counted as a Koofr pass.
- Recursive key/value evidence scan passed: no account password/user/Authorization,
  raw capability, probe or lock token in the retained reports. Synthetic Note IDs,
  epochs and request IDs are retained for reproducibility; bodies are not logged.

### Decision and remaining gaps

The specific release gate for sequential reconnect and independent-invocation
correctness has now passed this bounded test. No backend storage algorithm change
was needed for these cases. The root lock still serializes unrelated Notes; BUSY
recovery here is implemented by the test driver, not the Homepage client.

No literal Vercel process termination, prolonged provider outage, client/iPad network
loss, eviction of all recent receipts during an outage, cross-region/long-running
soak or production session/public-link/UI flow was validated. Do not equate a
successful reconnect with proof of arbitrary crash recovery. Restore-empty/init
retry gaps from the readiness audit remain unfixed, along with data-size/search
compatibility, private drafts, durable logging and independent backup retention.

Next: fix those restore edge cases, then prepare a secured adapter/contract preview
using synthetic data. Keep production on Blob. No new credential setup is needed to
repeat the existing lab before its expiry; a permanent server adapter still needs
a separately reviewed server-only configuration, not credentials pasted in chat. Deployment configuration and VERCEL_REGION report fra1, while the runtime-log
envelope annotates iad1. Physical execution region is not independently settled;
do not use this run for a region comparison. Small functional timings here are
not an iPad benchmark, reliability SLA or permission for production cutover.

Remaining release gates are documented in [KOOFR-READINESS-20261017.md](KOOFR-READINESS-20261017.md).
The Android TV launcher-style arrow-key Note reordering idea is recorded separately
in [NOTES-IDEAS.md](NOTES-IDEAS.md), for after stable operation; no UI work is included.
