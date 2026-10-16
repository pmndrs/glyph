---
type: Decision
title: Retained preparation and renderer-only publication
description: One synchronous retained layout pipeline serves setters, queries, copies, and render publication.
decision_status: Accepted
decided: '2026-10-12'
status: stable
sources:
  - resource: ../retained-text-assignment.md
    title: Retained assignment design and lifetime contract
  - resource: ../publication-frontier.md
    title: Implementation tasks and acceptance gates
generated:
  by: openai-codex/gpt-6
  at: '2026-10-12T11:22:21Z'
---

# Retained preparation and renderer-only publication

## Decision

A bound `set()` or property assignment invokes internal preparation synchronously. Rust owns retained text, Unicode,
shaping, and layout. Preparation validates and encodes the authored change, detects unchanged regions, computes only
invalid stages, and adopts one prepared revision before returning. Same-value sets reuse that revision. An unbound
object retains authoring values until normal binding invokes the same preparation executor.

`measure()`, glyph inspection, carets, and selections read that prepared revision. They may materialize requested
inspection columns but must not encode or shape the same input again. Unqueried text does not need a serialized
measurement sidecar during its setter or renderer acceptance. The first demand materializes its summary from
prepared clusters/layout; later reads reuse it, and setters keep an already-requested summary current. A clipped
inspection may first compose its intrinsic flow through the shared kernel; it does not repeat the authored shaping.
Three's explicit measurement and bounding-box getter demand those caches. Publication refreshes previously requested
bounds from the current cached summary to preserve returned Box3 references; unqueried Texts stay lazy. `split()` creates independently owned geometry,
metadata, and resource leases from that revision; its allocation/copy costs are inherent in independence. Selection
identities and copied records must refer to the same preparation and remain correct across sibling lifecycle changes.

Publication consumes accumulated dirty owners/ranges from prepared state. It gathers/encodes changed render records,
updates batch topology/bindings when required, and hands renderer updates to the host. Publication never rediscovers
text mutations or repeats layout for an already prepared revision. Rust/Codec owns layout and render-plan semantics;
Three and TypeGPU bind those results rather than reconstructing them. Structural or dense changes may require broader
work within the same data layout and executor. Keep batching and order semantics intact.

No public `prepare()` API is added. Preserve existing synchronous APIs and public signatures. One retained preparation
pipeline serves reads and rendering; retire speculative-query adoption, parallel preparation, and replaced bookkeeping.
Incremental rope summaries and SWAR may reduce invalid work, but cannot replace Unicode/shaping correctness rules.

Validate caller mutations before accepted-state writes. Preserve renderer-owned in-flight bytes. Prior state can be
reused as input/scratch; do not preserve it for undo. Unexpected post-write defects throw and invalidate derived state;
a later explicit operation rebuilds through the same executor. No hidden retries. Async copies remain deferred.

## Why

Query-first main proves that current measurements and independent copies do not require whole-root publication.
Durable preparation extends that separation: reads and publication consume the same result. Eager setters pay for
intermediate values, so setter-only, repeated same-value, and overwrite-before-render cases are mandatory benchmarks.
Compare complete equivalent operations; deferring work alone is not a speedup.

## Consequences

This refines D-373 and supersedes the speculative query transaction and committed-layout-equals-publication assumptions
in the former paragraph-query plan. Historical evidence stays historical. Preparation and renderer publication have
separate revisions and lifetimes. Main's query-first behavior remains the correctness baseline. Ropes remain unmerged;
no release, tag, or demo merge is authorized by this decision.

Acceptance requires cold/incremental parity, seeded edits and lifecycle coverage, prepared-read reuse, split independence,
batched and standalone rendering, bounded failure/rebuild tests, and real browser visual checks. Measure set-only,
set/read, set/read/publish, and set/split at 1/100/1,000 labels; include count changes, trailing spans, and scattered large
ASCII assignments. Compare the same frozen candidate against main and published 0.1.0 with absolute times. Record source
retirement and production additions/deletions, raw/gzip Wasm, and runtime delivery sizes after each wave. Unexplained
size growth or duplicated execution paths block readiness.
