---
type: Log Entry
title: 'Reduce retained preparation request and payload initialization work'
generated:
  by: process:docs-new
  at: '2026-10-18T14:07:37Z'
---

The [accepted preparation/publication contract](../planning/decisions/retained-prepare-publish.md) continues to use one synchronous Rust executor and the existing packed/SoA storage. Setter-only request construction now reuses a file-private frozen empty list for package-owned absent fields, snapshots every nonempty removal list, preserves removal-before-upsert order, and constructs one complete text mutation. No caller-owned list is shared. The synchronous wire encoder reads these lists without retaining or mutating them.

The ordered compiler now initializes a reserved payload segment directly from a complete valid retained-buffer slice, including aligned padding and tails. The fallback still zero-initializes every segment without that proof. Checked bounds, fallible reserve, canonical encoding, equal-write compaction, rejection/rebuild, and publication ownership remain authoritative. This removes zeroing immediately overwritten by the retained copy, without another arena, cache, storage format, executor, or ABI.

Native Sol6 Medium implemented only `render-planner.ts` and `ordered_plan.rs`. TypeScript, targeted format/lint, Rust formatting/Clippy and 46 ordered-plan native tests pass. A fresh scoped Sol High review traced request consumers, callback/evaluation order, full old-buffer range proofs and recovery, with no material finding. Existing cold full-output, aligned-tail, multi-job, abort/rejection, synchronous setter, prepared-query and split oracles remain the correctness authority. Consolidated shipping build, real-Wasm, named artifact, size/memory, browser and same-machine performance gates are pending at this source checkpoint. No elapsed improvement or regression clearance is claimed.

The [compact frontier](../planning/publication-frontier.md) retains all seven families and the unresolved dense512/1024 and current-main integration holds. Earlier inconclusive compiler/combination options remain preserved for compatible combinations.
