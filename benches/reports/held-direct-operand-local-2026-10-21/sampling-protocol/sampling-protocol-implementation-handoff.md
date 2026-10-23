# E6 fixed sampling protocol implementation handoff

**Status:** The pinned Labs 0.9.0 protocol patch and package benchmark harness are implemented and pass focused correctness gates. No E6 elapsed benchmark, full matrix, product build, package check, browser, profile, or memory run was performed. Fresh High review is the next gate before E6 timing.

## Protocol and normal invocation

The package workflow now accepts `--sampling adaptive|single-call`; its default remains `adaptive`. For the E6 full matrix, invoke the existing named workflow with `--suite full --blocks 8 --sampling single-call` for every candidate and baseline arm. Run the E6 candidate only once in the first arm and pass `--saved-candidate <first-arm-output>` to the other two arms. Each arm's manifest records `samplingPolicy`, and saved candidate reuse requires an exact policy, artifact, suite, block count, Labs version, machine/runtime, and harness digest match. An old manifest with no policy cannot be reused as fixed data.

The pnpm dependency patch adds typed `LabsConfig.samplingPolicy?: 'adaptive' | 'single-call'`, defaults it to adaptive, validates invalid values, forwards the resolved policy explicitly from CLI to the worker, and passes `batch: false` to the existing Labs measurement tune only for single-call. It does not modify the measurement loop, callback, fixture, timer, or benchmark identity. The worker and CLI still strip or ignore inherited `LABS_*` tuning variables in the normal path.

The runner fails closed in single-call mode if any successful saved row lacks `stats.plan.batch === false` or eight finite block medians, and if the full candidate result does not have 145 identities. Candidate check errors still fail; baseline check errors remain disclosed as unavailable comparisons. Missing published 0.1.0 outline APIs remain unsupported and are not repaired by this sampling policy. Existing E5 adaptive samples stay historical and cannot be relabeled or pooled with fixed-policy samples. Labs' existing `minDelta: 0.05` display threshold was left unchanged; final admission must inspect the saved confidence intervals, p values, and Hodges–Lehmann estimates rather than count neutral labels as parity.

## Patch identity and scope

- Patch: `patches/@pmndrs__labs@0.9.0.patch`, SHA-256 `1475111a563f675ba8de804b57a4a7500acad4f500771713dad8ad33b5be3002`. `pnpm-workspace.yaml` registers this exact 0.9.0 patch; the lockfile records the same patch hash.
- Final harness digest before any E6 run: `1313fad472f6490c4b7704fde817fc53070a3f66460f611a7f0653a0a8c1ac51`. It includes the patch bytes, pnpm workspace and lockfile, Labs config, runner, result and saved-run logic, and existing benchmark inputs. The digest is recalculated at run time and will change if any of those inputs change.
- Changed benchmark files: `benches/labs.config.ts`, `benches/scripts/run-package-labs.mts`, `benches/scripts/support/labs-result.mts`, `benches/scripts/support/saved-package-labs.mts`, `benches/scripts/release-labs-comparison.test.mts`; new `benches/scripts/check-labs-sampling-protocol.mts` and `patches/@pmndrs__labs@0.9.0.patch`; pnpm workspace and lock registration.
- Lockfile structural audit confirms every package resolution, every other importer, and every other snapshot is unchanged. Only the Labs importer/snapshot key and patch registration changed. Glyph runtime/build dependency versions are unchanged. No product source, shipped dist, benchmark callback, fixture, or Labs installed package was hand-edited. Pnpm's patch workflow generated the patched installed dependency.

## Focused evidence

- `protocol-proof.json`: named `benchmark:labs-sampling-protocol-check` used the actual pinned patched Labs CLI and worker with an isolated ESM fixture. The forced-eligibility adaptive measurement batched; the explicit fixed measurement did not. The CLI/worker saved eight fresh block medians under `plan.batch=false`; invalid public config and invalid runner option were rejected. Eligibility used infinite thresholds in the isolated underlying measurement control, so this conclusion does not depend on a lucky clock threshold. Fixture timings are protocol correctness evidence only.
- `static-audit.json`: patch SHA equals lock registration; non-Labs lock dependency graph is unchanged; `benches/labs` source is unchanged; historical saved full candidate JSON has 145 identities. This checks discovery structure without running the full timing suite.
- Final `benchmark:static-check` passed; final `benchmark:release-comparison-check` passed all nine tests; `git diff --check` passed. Saved-run tests cover policy mismatch, missing old policy, and dependency patch content in the digest.

## Remaining gate

Obtain fresh High review of this exact protocol diff and receipts before an E6 matrix. Then run the candidate once and each of main, published 0.1.0, and E2 under the same explicit fixed policy. Preserve all raw Labs plans, block medians, per-call samples, p50/p95, confidence intervals, calibration warnings, checks, and availability gaps in the final report. No performance or seven-family parity claim follows from this implementation proof alone.
