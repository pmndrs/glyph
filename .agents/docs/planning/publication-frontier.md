---
type: Engineering Plan
title: Publication frontier checklist
description: Compact resume point and task tracker for the 0.2.0 publication frontier.
status: draft
sources:
  - resource: retained-text-assignment.md
    title: Detailed design, lifetimes, evidence and artifact hashes
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T16:40:14Z'
---

# Publication frontier checklist

Current resume point: the standalone producer-owned publication contract source is committed as `4d4e12bc`, with documentation-only checkpoint `1e302dff`, on `feat/retained-host-publication`, based on remote main `305e5ec9`. The rope draft is rebased above it as the real dependency `main → feat/retained-host-publication → feat/publication-range-spike`. Original rope history remains in `feat/backup-rope-before-host-publication-20261010`; the full binary delta is saved under `.cache/rebase-host-publication-backup/`.

The standalone packed release candidate is SHA256 `7034dd5e834ce14b8e39c36349e56975604a382a1ab8e8e09ab93bdffe9fbd91`, shaper `9ce201c984f02b514689dfc08603db29c537b790e848b13f3b3fd61475e70188`. Its native 330-unit plus 10 integration/conformance tests, focused 133 and full 953 Node tests passed. Strict standalone Glyph package check 10489 exited successfully. ASCII live checks passed at DPR 1 and 2 against the standalone contract. The combined stream source passes 399 native unit plus outline/Unicode controls, its first built package passes all 990 Node tests, and final formatting/Clippy cleanup passes static check 11300 and repeated native suite 16628. Final rebuilt artifact, fuzz, size and timings remain pending. Never use an older rope or tactical Three artifact to validate this source.

The release decider is registry **0.1.0 → this standalone candidate**, not an additional isolated main comparison. Full four-block Labs completed: **45 faster, 9 slower, 45 neutral, 3 excluded** after correcting timing-mode exclusions. Baseline clock drift was **11.3%**, so absolute deltas remain qualified; slower workloads remain open findings. Report and manifest: `.cache/publication-contract-main/.cache/retained-host-release-full/`. Standalone strict package and ASCII DPR 1/2 checks passed; comparative package size passed (+1,161 raw / +331 gzip shaper bytes against authenticated cached main); exact-head CI review remains pending, and combined-source checks are still outstanding; no release-readiness claim.

The small main cut may ship independently. The rope/#247 frontier remains unfinished and draft; the user accepts considering the remaining frontier for 0.3.0. Public full assignments, synchronous reads, batching, rejection recovery and explicit publisher lifetime must survive every cut. Retire replaced paths and keep one preparation/publication implementation.

1. [x] Retained gather ranges, accumulated SET dirt, count-changing suffix splice, pending-owner/transform reuse and batch-key resource enumeration share existing owners/executors. Existing cold/seeded/recordless/abort proofs are in the [detailed design](retained-text-assignment.md) and [consumer-range evidence](../log/2026-10-10-publication-consumer-ranges.md).
2. [x] Retire Three key copies and root revision walks; omit unchanged geometry through the same setter and reuse validated retained styles. Empty publication retains its adapter until explicit teardown. Indexed/direct late-sibling and synchronous-read controls remain required.
3. [x] One inspection owner handles sparse reads and dense promotion, including independent owned copies and outline lifetime. See the detailed design for `82b288ac`/`af794d8e` source, cold and hardware evidence.
4. [x] Package-minted private IDs retain public Codec/stable-ID and Rust ownership validation while retiring redundant JS checks. [Producer evidence](../log/2026-10-10-publication-private-paragraph-provenance.md) records neutral scoped timings.
5. [ ] Close the remaining bulk/publication regression. Coalesced placement scopes and exact-full ordered admission retire point descents, but counter improvements alone did not establish elapsed improvement. [Placement evidence](../log/2026-10-10-publication-placement-range-coalescing.md) and [bulk attribution](../log/2026-10-10-publication-bulk-work-attribution.md) remain diagnostic. Rollback redesign is deferred.
6. [x] Three queued-root preflight uses the existing engine registration Set. Unqueued hierarchy checks and authoritative preparation remain. [Evidence](../log/2026-10-10-publication-queued-root-preflight.md). The separate scheduler proposal is held.
7. [ ] Integrate exact draw map/reduce into the existing instance rope/reducer; preserve rank-reorder context, finite/extrema/signed-zero/order/u16/abort semantics. No alternate draw executor or enlarged unrelated rope records. See the detailed design before implementation.
8. [ ] Clear cumulative maintainability, retirement and binary-size gates on the exact combined source. Named diagnostics preserve production executable bytes and complete final-index provenance; profiles are attribution evidence, not release clearance.
9. [ ] Complete exact-head strict package/hardware/CI review and PR landing. The real stack is published: [#291 publication](https://github.com/pmndrs/glyph/pull/291), ready for review with `benchmark:edit-sized`; [#292 rope](https://github.com/pmndrs/glyph/pull/292), draft with `benchmark:stress`. Full release Labs above is the release comparison. Local trunk metadata now matches main 305e5ec9; both reviewed heads survived the real gh-stack refresh unchanged. Merge only a validated layer; do not publish a release or merge the demo.
10. [ ] Update release-readiness manifest and roadmap only after accepted gates. #240 remains held; #247 remains open. Sync and visually verify ASCII when main advances, preserving application work.

Integrated gather-owner stream originated in patch `/tmp/glyph-gather-owner-stream.patch`, SHA256 `9b4f276c5c770cca0e2eb7a0f0206a18b4fd75cf36f933386c8ccc9214c3811c`, then received the pinned formatter and four Clippy cleanups. Backup `feat/backup-rope-before-gather-stream-20261010` preserves the pre-stream tree. It replaces per-owner recursive gather walks with one range stream through the same source owner/callback; Stop adopts the completed prefix before the existing suffix builder resumes. Cold, failure, recordless, count-change and decorated-gap controls pass in the combined native suite. Independent scoped reviews found no actionable defect. Final artifact size/Labs and browser clearance remain open. Three tactical table-comparison reuse and the WeakMap proposal are held; producer-owned Rust→command topology authority supersedes the tactical approach.

Integration resolution preserves rope's cached complete transform table and existing pending-owner index. Before Rust adoption, the pending owners authenticate unchanged root handles, ordered flow handles, lifecycle/order and removals; the staged publication carries that ephemeral proof. No semanticDirty, obsolete measurement reconciliation or second transform cache is restored.

Historical wave details remain in [retained-text-assignment](retained-text-assignment.md), existing dated publication logs and backed-up Git history. CPU lanes are coordinated by the root agent; do not infer a live lane from this durable tracker. All source changes after rebase require a fresh build before runtime comparison.

Next bounded investigation: width measure, glyph inspection and publication regressions share current `state.rs::prepare_flow_layout` line-edge shaping after `prepare_flow_lines`. Current `attach_line_edges` traverses fragments with `ShapedBreakCorrections`; 0.1.0 lacks this tail. Repeated boundary shaping is a source-traced hypothesis, not sampled attribution. Profile before changing it; any reuse must stay in existing `boundary_shape` storage and preserve line-edge correctness. No implementation or extra main performance comparison is authorized here.
