# Fixed sampling High correction handoff

**Status:** Both accepted findings in `fixed-sampling-high-review.md` are corrected in the benchmark harness. Final `benchmark:static-check`, `benchmark:release-comparison-check` (11/11), and `git diff --check` pass. No E6 full timing, product build, or shipping-source change was performed. The earlier eight-block `protocol-proof.json` remains unchanged and is protocol evidence only. Fresh High correction review is the next gate before matrix timing.

## Corrections

1. A saved candidate declaring `samplingPolicy: single-call` now requires a present, well-formed, matching `harnessDigest`. The old Git-diff fallback remains only for legacy adaptive manifests. The persisted-result negative control commits an older benchmark source, adds an untracked Labs patch, changes that patch, and verifies both mismatched-digest and missing-digest fixed manifests are rejected. An adaptive saved fixture still follows its existing path.
2. Every `--suite full` candidate must contain 145 distinct exact identities. The default `--baseline-availability complete` requires the baseline identity set to equal the candidate set, for main and E2. The caller may explicitly choose `--baseline-availability published-no-outlines` before the published run; only the two exact `outlines.bench.ts` identities under `glyph outlines`, with their documented alias/name and empty args, may be absent. The declared mode is written to that arm's manifest. It is not compared by saved-candidate validation, so the exact same main-arm candidate JSON can be reused in the published arm. Baseline rows with failed checks remain present identities and remain disclosed as failed checks, rather than being counted as healthy comparisons.

The focused tests reject a truncated 145-row candidate, missing main/E2 baseline rows, an unexpected published omission, the wrong 143-row shape, and an extra substituted identity. They accept only the complete set or the declared exact two-outline published absence. A read-only projection over the historical E5 saved results accepts main and E2 with 145 identities and published with the exact 143 applicable identities. That projection establishes schema compatibility, not E6 performance.

## Identity and receipts

- Corrected harness digest: `badf82b0d84dbced158f4bb44ee50b7adac7169323f295d108909c2b93413627`.
- Corrected file hashes, final focused gates, and historical identity projection: `high-correction-receipt.json` in this directory.
- Pinned Labs patch SHA-256 remains `1475111a563f675ba8de804b57a4a7500acad4f500771713dad8ad33b5be3002`; the actual eight-block worker proof is still `protocol-proof.json` (SHA-256 `f6270b39bcb2b7a45fd90885342e75c0b075a1ec8c2fa1c7af65cfdaac6fd7b0`). No worker, timer, callback, fixture, benchmark registration, lockfile, or sampling-policy behavior was changed by this correction.
- Corrected source ownership: `benches/scripts/run-package-labs.mts`, `benches/scripts/support/labs-result.mts`, `benches/scripts/support/saved-package-labs.mts`, and `benches/scripts/release-labs-comparison.test.mts`. Other original protocol files are unchanged since the first High review.

## Exact three-arm commands after fresh correction review

Run sequentially from `/Volumes/Depot/Developer/glyph/.cache/held-rerun-20261019/repo`. The first arm times E6 candidate once. The next two arm commands reuse the saved candidate; they still time their own baselines under the same fixed policy.

```sh
mise exec -- pnpm scripts run benchmark:labs-package -- --candidate /Volumes/Depot/Developer/glyph/.cache/held-row-view-20261021/evidence/candidate/pmndrs-glyph-0.1.0.tgz --baseline /Volumes/Depot/Developer/glyph/.cache/held-rerun-20261019/evidence/controls/main-4e25a96a.tgz --suite full --blocks 8 --sampling single-call --output /Volumes/Depot/Developer/glyph/.cache/held-row-view-20261021/evidence/matrix-main-fixed-data
mise exec -- pnpm scripts run benchmark:labs-package -- --candidate /Volumes/Depot/Developer/glyph/.cache/held-row-view-20261021/evidence/candidate/pmndrs-glyph-0.1.0.tgz --baseline /Volumes/Depot/Developer/glyph/.cache/held-rerun-20261019/evidence/controls/published-0.1.0.tgz --suite full --blocks 8 --sampling single-call --baseline-availability published-no-outlines --saved-candidate /Volumes/Depot/Developer/glyph/.cache/held-row-view-20261021/evidence/matrix-main-fixed-data --output /Volumes/Depot/Developer/glyph/.cache/held-row-view-20261021/evidence/matrix-published-fixed-data
mise exec -- pnpm scripts run benchmark:labs-package -- --candidate /Volumes/Depot/Developer/glyph/.cache/held-row-view-20261021/evidence/candidate/pmndrs-glyph-0.1.0.tgz --baseline /Volumes/Depot/Developer/glyph/.cache/held-wave2-20261020/evidence/candidate/pmndrs-glyph-0.1.0.tgz --suite full --blocks 8 --sampling single-call --saved-candidate /Volumes/Depot/Developer/glyph/.cache/held-row-view-20261021/evidence/matrix-main-fixed-data --output /Volumes/Depot/Developer/glyph/.cache/held-row-view-20261021/evidence/matrix-prior-e2-fixed-data
```

The published outline APIs remain unsupported in that archive. Final admission must use the saved per-row CI, p value, and Hodges–Lehmann estimate, including effects below Labs' unchanged five-percent display threshold; neutral labels alone do not prove parity. Existing E5 adaptive samples remain a separate historical series.
