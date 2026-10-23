---
type: Log Entry
title: 'Use direct leaf iteration over the retained rope storage'
generated:
  by: process:docs-new
  at: '2026-10-18T14:26:11Z'
---

The [preparation/publication contract](../planning/decisions/retained-prepare-publish.md) retains one synchronous Rust
executor and one canonical packed/SoA rope storage. The preceding request/payload source checkpoint `4c72fcc6` passed
the full Glyph check, packing and authenticated named/memory artifact gates on this machine. Its packed package
SHA-256 is `a75973feeab8f101755869cdbf21b478dedef30af28a0e398c336104b867f102`; shipping shaper SHA-256 is
`ced8f59447b0df54525fcc07a054f26f4ad703e1ca52d79dc76e4b2b12736395`.

One current1024-label bulk-write scene-publication diagnostic used ten warmups, eighty iterations and no timed reads.
The exact capture assigns 942,585 microseconds exclusively to preparation, 459,247 to publication and 132,459 to
detached/runtime stacks, totaling 1,534,291 microseconds. The anchors are sibling nodes7 and67 in that capture, not
reused IDs from another profile. Its diagnostic p50/p95 are18.081208/22.777834ms; these are not paired acceptance
timings. Profile SHA-256 is `a8e9893edf9733a3741f2b7585f7f7d284247158cd71dd636180cb6129e6926f`.

The next coherent candidate combines those request/payload reductions with direct iteration of existing leaf slices.
`RopeIter` now selects a borrowed slice iterator for a leaf-local range and the original two-stack kernel for a range
crossing branches. `RopeRange` already lowers ranges to their smallest containing node. The old unconditional stack
initialization is retired from the leaf source path; the original tree traversal has one implementation in
`TreeRopeIter`. Cursors retain root-relative indices, summary skipping and borrowed lifetimes. There is no duplicated
record store, heap allocation, cache, new parser, executor or public API/ABI. Leaf construction is constant work;
tree construction remains proportional to height, and traversal remains proportional to visited records plus tree
navigation. The transient inline enum still has the tree variant's maximum size.

Native Sol6 Medium implemented the change; fresh scoped Sol High review found no blocking correctness or ownership
issue. Flat-slice oracles cover every valid subrange of sizes0,1,31,32,33,65, mixed front/back iteration, nth, exact
length and exhaustion. A separate single-leaf cursor sequence checks index/slice synchronization through repeated
peek, take, advance and next operations. All16 focused rope tests, Rust formatting and strict all-target Clippy pass.
Existing downstream cold-output, Unicode, split, publication/rejection and lifetime oracles remain required.

Optimized-Wasm inspection must establish whether the leaf path actually avoids the prior initialization/copy, including
representative callers: the large inline enum can still induce copies. No elapsed gain, global bottleneck rank or
regression clearance is claimed from the source diff. Consolidated shipping correctness, raw/gzip size, live/peak
memory and one frozen main/published/previous-HELD matrix follow this combined candidate. Inconclusive correct options
remain preserved. The [compact frontier](../planning/publication-frontier.md) retains all seven families and final
API/ABI/peer/lifetime/browser/hero/current-main requirements; the stack remains held and unmerged.
