# Fixed sampling protocol: High correction review

**Verdict: the two findings in the original High review are corrected; no remaining protocol admission finding in this scoped re-review.** This clears the corrected benchmark harness for the root-owned, sequential E6 full matrix, subject to the root's final artifact/source bridge. It does not claim E6 performance, seven-family parity, or supported outline APIs in published 0.1.0. I read the frozen source and receipts only; I ran no build, gate, test, timing, or Git mutation.

The reviewed checkout is `/Volumes/Depot/Developer/glyph/.cache/held-rerun-20261019/repo`, HEAD `b8fc4ce023f667c714e1b797ef9ff6ec0ec3fa0d`, with the corrected benchmark files still uncommitted. The original [fixed sampling High review](fixed-sampling-high-review.md) is preserved byte-for-byte at SHA-256 `416e8f2b22be516d5cdd9fa87ea91e4e315b4200558abee9b3479886da2b86fb`. This report supersedes only its two open findings, not its protocol scope or caveats.

## Corrections verified

1. **Saved fixed-policy reuse now fails closed on missing or changed input identity.** `validateSavedPackageLabs()` checks the exact saved artifact, suite, blocks, policy, machine/runtime, successful candidate rows, and fixed plans. It then rejects a `single-call` manifest lacking `harnessDigest` before reaching the legacy Git-diff branch; a present but malformed or unequal digest also fails. `packageLabsHarnessDigest()` reads the actual listed benchmark and patch bytes, including a nonignored untracked patch. The focused negative control uses a real temporary Git repository with an old committed benchmark and an untracked Labs patch: editing the patch rejects the matching saved digest, and deleting the digest rejects fixed reuse even though the old Git commit is available. Adaptive legacy fallback remains distinct. Sources: `benches/scripts/support/saved-package-labs.mts:64-125`, `benches/scripts/release-labs-comparison.test.mts:117-169`.

2. **Full matrix identity coverage now has an exact admission contract.** For every `--suite full` run, `assertFullLabsCoverage()` requires 145 distinct candidate identities, rejects duplicate identities, and compares the full baseline identity set against the candidate. The default `--baseline-availability complete` admits all 145 and is used by main and E2. Explicit `--baseline-availability published-no-outlines` deletes only the two exact `outlines.bench.ts` / `glyph outlines` identities with the documented alias, name, and empty arguments, so published must have the other 143 exactly; an unexpected omission, substitution, or extra outline is rejected. The option requires a baseline and full suite, and each arm's manifest records it. Saved candidate validation intentionally does not require identical baseline availability, allowing the main-arm candidate JSON to be reused in the published arm while retaining its 145-identity and fixed-plan checks. Failed baseline checks keep their identities and remain separately reported as unavailable comparisons. Sources: `benches/scripts/support/labs-result.mts:7-73`, `benches/scripts/run-package-labs.mts:113-118,228-247,148-153`, `benches/scripts/release-labs-comparison.test.mts:171-227`.

The `high-correction-receipt.json` historical projection accepts the E5 main and E2 schemas with 145 identities each and published with exactly the two outline omissions and 143 identities. That projection tests the coverage rule against saved shapes; it is not E6 timing. The handoff records `benchmark:static-check` passed, `benchmark:release-comparison-check` 11/11 passed, and `git diff --check` passed. I checked the recorded source SHA-256 values against the current files and inspected the tests; I did not rerun those gates.

## Frozen identity and limits

| Item | SHA-256 |
| --- | --- |
| Corrected harness digest recorded before timing | `badf82b0d84dbced158f4bb44ee50b7adac7169323f295d108909c2b93413627` |
| `benches/scripts/run-package-labs.mts` | `bd32e2b307d8c3105fb44996cb6f318114a266eae7c73363aa407c759ee85589` |
| `benches/scripts/support/labs-result.mts` | `7299ef7c78c3db4e38093ea463c95cd96ccf8bd0b65581f72d9fe4c5325efc02` |
| `benches/scripts/support/saved-package-labs.mts` | `12742cf68755a09c9b30fe3dc9a3973b680f9e0ad0bd445e0c653891596a19cf` |
| `benches/scripts/release-labs-comparison.test.mts` | `59f73efd2fa39627ce921395bf5e4da6dfbba7dd07c778bb5cc6f2ec36993342` |
| Labs 0.9.0 patch, unchanged | `1475111a563f675ba8de804b57a4a7500acad4f500771713dad8ad33b5be3002` |
| Eight-block worker protocol proof, unchanged | `f6270b39bcb2b7a45fd90885342e75c0b075a1ec8c2fa1c7af65cfdaac6fd7b0` |
| Correction handoff | `ba4c0cdbf1275c6357bbf709c83cb38059f1814e62761b9f74df9ed892c02d00` |
| Correction receipt | `95d48985d58432a60a78973422d4bdf4c523b08386e20e2b218e84c8f0f5d950` |

The installed Labs path still names the same 0.9.0 patch hash. The prior isolated worker proof remains one fixture under eight blocks, with deterministic adaptive-batched and fixed-single-call controls; it is not a full-suite measurement. No E6 elapsed result exists in these receipts. The corrected source leaves the pinned dependency patch, timer, callback bodies, fixtures, benchmark registration, and lockfile unchanged. Docs and reports edited concurrently outside the harness do not enter this protocol verdict; the root should confirm the source/artifact bridge and recorded digest immediately before timing.

The handoff's three exact commands are now syntactically supported: each uses `--suite full --blocks 8 --sampling single-call`; the published arm alone adds `--baseline-availability published-no-outlines`, and the published and E2 arms use `--saved-candidate` pointing to the main arm. After timing, inspect actual manifests, identical reused candidate JSON, every successful row's `stats.plan.batch=false` and eight medians, declared identity sets, baseline errors, and unrounded CI/p/Hodges–Lehmann estimates. Labs' existing `minDelta: 0.05` label remains a display/diagnostic threshold, not an admission floor. E5 adaptive samples must remain a separate historical series, and published's two unavailable outline rows cannot count as parity passes.
