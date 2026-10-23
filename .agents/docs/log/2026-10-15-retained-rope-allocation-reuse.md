---
type: Log Entry
title: 'Retained rope allocation reuse and packed placement construction'
generated:
  by: openai-codex/gpt-6
  at: '2026-10-15T01:23:45Z'
---

The held [preparation/publication frontier](../planning/publication-frontier.md) keeps the single retained executor and logical32-record rope leaves. New leaves initially reserve for actual demand. Clearing a uniquely owned root leaf now reuses its existing Arc/Vec as logically empty scratch; shared and tree roots release normally, and joins exclude empty branch children. Placement construction retires scalar pushes in favor of existing packed appends through one bounded stack chunk, flushing before retained gaps. [Package ownership](../packages/glyph.md) documents these policies. No new pool, persistent field, representation, public API or ABI was added.

The intermediate75fe artifact passed470native/1047Node tests. Its authenticated71-phase allocator capture shows stable dense-cycle requested-live43,792,647→40,343,815bytes; allocations/free6858→2762 each and requested bytes5,143,608→349,240 per warm1024-label update. Reallocations0→384 and extra sparse reallocations remained visible, prompting the packed-placement correction. This is allocator-requested work, not timing, physical fragmentation or proof that the later artifact removes all384 reallocations.

Final source hashes are retained_rope b530eecb and placement_slot_arena075e5006. Final-gate/attempt1 stopped on a new-test Clippy warning; its diagnostics remain preserved. The corrected attempt2 passes static,471native/1047Node tests, optimized build, pack, size and docs checks with unchanged maintained-source closure/index/lock. Frozen package5cd8956d4954b040ec73b7123c1aaa23a43791f07e59d502936dd5d976da6800 has1573defined Wasm functions,1,598,467raw/591,279whole-gzip bytes: cumulative wave+3248raw/+450gzip versus c618. Only Wasm differs from75fe;237JS/226declarations and every other member are identical. Exact receipts/preimages live under .cache/retained-prepare-publish-wave2/order-ownership-wave/rope-tail-capacity-wave/; intermediate memory proof is .cache/rope-allocation-wave-live-memory/attempt1/.

Dense performance acceptance, final main/0.1.0 comparisons, cumulative delivery budget, peer/ABI/lifetime and current browser/hero gates remain open. A coherent full comparison is next, reusing one frozen candidate run across the two baselines. Fresh source attestation waits for coherent staging because docs:attest hashes the preserved index, not these unstaged edits. No merge, release or speedup verdict is made.
