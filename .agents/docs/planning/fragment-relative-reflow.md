---
type: Implementation Plan
title: Fragment-relative retained reflow
description: Replaces glyph-wide width-update materialization with stable run-local data, then extends the same retained layout authority to polygon exclusions, projected 3D obstacles, and drop caps.
documentation_type: explanation
tags: [glyph, layout, reflow, performance, wasm, three, typegpu]
status: draft
sources:
  - id: design-baseline
    resource: https://github.com/pmndrs/glyph/commit/2094243668bcf5462cff0ac3b1f7faf52cba3b6c
    title: Post-merge main used to prepare the frontier design
  - id: width-performance
    resource: https://github.com/pmndrs/glyph/issues/154
    title: Paragraph width-update performance issue
  - id: numeric-history
    resource: https://github.com/pmndrs/glyph/pull/134
    title: Wide fixed-point fit restoration while retaining f64 positioning
  - id: rust-state
    resource: ../../../packages/glyph/rust/shaper/src/engine/state.rs
    title: Retained Rust paragraph state and geometry-only preparation
  - id: cluster-state
    resource: ../../../packages/glyph/rust/shaper/src/engine/cluster_state.rs
    title: Cluster arena, sparse word-break records, and chunk summaries
  - id: flow
    resource: ../../../packages/glyph/rust/shaper/src/engine/flow_composition.rs
    title: Region flow and line composition
  - id: flow-geometry
    resource: ../../../packages/glyph/rust/shaper/src/engine/flow_geometry.rs
    title: Existing retained rectangle and polygon region/exclusion kernel
  - id: positioning
    resource: ../../../packages/glyph/rust/shaper/src/engine/positioning.rs
    title: Absolute glyph positioning and geometry revision assignment
  - id: gather
    resource: ../../../packages/glyph/rust/shaper/src/engine/codec_gather.rs
    title: Codec semantic gather and record publication
  - id: codec
    resource: ../../../packages/glyph/rust/shaper/src/engine/codec.rs
    title: Validated codec and program contract
  - id: abi
    resource: ../../../packages/glyph/rust/shaper/src/abi_contract.rs
    title: Generated Rust and TypeScript ABI authority
  - id: query
    resource: ../../../packages/glyph/src/internal/render-planner.ts
    title: Synchronous measurement and borrowed glyph inspection
  - id: three-geometry
    resource: ../../../packages/glyph/src/three/internal/geometry.ts
    title: Three unit-quad and instance-count realization
  - id: three-renderer
    resource: ../../../packages/glyph/src/three/command-buffer-renderer.ts
    title: Three command-buffer realization
  - id: typegpu-renderer
    resource: ../../../packages/glyph/src/typegpu/internal/renderer.ts
    title: Renderer-neutral TypeGPU command-buffer realization
  - id: package-evidence
    resource: ../packages/glyph.md
    title: Glyph package boundaries and measured release evidence
  - id: prepared-query
    resource: paragraph-query-preparation.md
    title: Paragraph-scoped preparation and synchronous query contract
  - id: dirty-ranges
    resource: dirty-range-upload-research.md
    title: Adaptive dirty-range upload research
  - id: editorial-flow
    resource: editorial-flow-layout.md
    title: Editorial regions, exclusions, reading order, and product proof
  - id: roadmap
    resource: ../roadmap/roadmap.md
    title: Milestone 12 responsive flow-region and mixed-raster goals
generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-09T09:25:07Z'
---

# Fragment-relative retained reflow

## Decision

Replace width-update glyph materialization with a core-owned retained run model. Shaping produces immutable glyph-local
data inside stable **layout runs**. Reflow moves, reorders, splits, or decorates run entities at legal boundaries and
publishes compact placement/order/decorations instead of recomputing and republishing every glyph's absolute position.

This pre-alpha cutover deliberately re-pins the final coordinate contract. Fit and justification decisions remain in the
16-fraction-bit `i64` lanes, and shaping, advances, local geometry, pen construction, and slice placement remain `f64`
inside the CPU. At the publication/realization edge, however, run-local and placement components narrow separately to
`f32`, and CPU semantic/query output and every renderer apply the same ordered `f32` placement operations defined below.
The previous ordered absolute-pen `f64` fold followed by one `f32` narrow is comparison evidence, not a compatibility
contract. There is no permanent absolute-position bypass, fallback materializer, or selectable second production mode.

The feature remains fragment-relative in user-facing prose, but `LayoutRun` is the sole retained placement-run entity.
`FlowFragment` and public `SEMANTIC_FRAGMENT` describe output pieces of a logical line inside flow slots; they are not a
second run arena or positioning system. A word is not always one stable unit: shaping, font geometry, bidi shaping
direction, or a boundary replacement may split it. Paint, material, raster technique, and decoration do not. A layout
run is the largest glyph interval whose local geometry and shaping-time internal order remain valid when a line break or
paint assignment moves.

This is one renderer-neutral pipeline:

```text
unit quad
  -> immutable glyph-local ink and raster size
  -> stable run-local glyph placement
  -> mutable line/fragment placement and visual order
  -> paragraph/region transform
```

Three, `/three/typegpu`, and `/typegpu` consume the same core layout authority. No adapter may implement line layout,
run placement, bidi ordering, or its own semantic placement cache; retained GPU mirrors are realization resources only.
Their validated wire encodings may differ until every renderer proves the indexed representation.

Topology reduction comes before SIMD. Existing evidence does not establish SIMD as the dominant remaining lever; the
current path is dominated by glyph-wide positioning/materialization, semantic gather, change detection, and publication.
Only a measured dense placement or comparison phase may gain a vector kernel.

## What the baseline proves

The planning baseline is freshly fetched post-merge `origin/main` commit
`2094243668bcf5462cff0ac3b1f7faf52cba3b6c`, not a remembered revision or recovery worktree. M0 must fetch again and
record the then-current remote commit and artifact hashes immediately before implementation.

- Built-in Bitmap, MTSDF, Slug, and decoration paths already use a static `[0, 1]` unit quad. Shaders expand it from
  instance origin and size; normal width changes do not rebuild CPU vertex quads or convex hulls.
- Geometry-only preparation retains shaped glyphs and clusters, then reruns flow and positioning. Broad shaping is
  already skipped. Boundary shaping is an ellipsis/replacement concern, not the ordinary width path.
- `ClusterArena` already owns lazy sparse word-break records and chunk summaries. Sparse prose can fit lines at word
  granularity; dense character wrapping remains a different workload.
- Equivalent width classes already reuse positioned state and publish nothing. For changed classes, however,
  `position_fragment`, geometry-revision assignment, codec gather, and diff still walk or materialize absolute glyph
  records.
- The final four 22k width-reflow candidate runs measured `1.251–1.317 ms` median / `3.642–3.723 ms` p95, versus
  `1.654–1.663 / 4.062–4.328` in their exact interleaved baseline runs. Measurement-query evidence was
  `0.282 / 0.341`, versus `0.517 / 0.711`. Browser Paragraph Stress
  update medians were approximately `0.665–0.750 ms`, versus main `0.785–0.795`; update plus measurement was
  approximately `0.510–0.565`, versus main `0.580–0.605`.
- Prior attribution found roughly one-third equivalent-width no-publication cases, a common full-publication class near
  `170 KiB`, and a small doubled-compute p95 class. The latest short circuits address the first class, not glyph-wide
  changed-width publication.
- Previous explicit SIMD attempts did not improve width/measurement lanes before topology changes. Line selection also
  contains serial prefix and break dependencies. Existing SIMD/chunk summaries should remain untouched unless a new
  proof beats them.

The first milestone must reproduce these numbers and attribute the current total. If attribution contradicts this
model, stop and revise this plan before changing the ABI.

The first frozen M0 run built the unchanged product source at `2094243668bcf5462cff0ac3b1f7faf52cba3b6c` with explicit
production SIMD. Its `text-shaper.wasm` is 1,205,265 bytes with SHA-256
`27c5dc5c8555506211c01f99040ef1210a34992e5a70a75ad758cd6ba816fd55`. On this machine, 22k Bitmap column resize measured
`1.144 / 3.605 ms` aggregate median/p95; the 54 of 101 samples that actually published the 174,440-byte plan measured
`1.493 / 3.743 ms`. The paired measurement-only lane measured `0.192 / 0.226 ms`. These are an attribution checkpoint,
not the required three-round baseline or a merge claim.

The first M1 proof kept `LayoutRun` and both consumers behind test/kernel-lab compilation. Maximal adjacent
`(source_run, font_handle)` topology preserves gapless cluster ownership and contiguous glyph spans; 4,096 homogeneous
CJK clusters remain one run even across legal breaks, paint bindings, and negative advances. The extent walker is
`O(log R + overlapping R)` and samples font metrics once per intersecting non-hard-break run. Ordinary base-LTR,
zero-indent slices match current output across the normal mixed/fallback/ligature corpus, while deterministic inline and
block counterexamples prove that algebraically reassociated run-local-plus-translation `f64` is not universally bit-exact.
The separate 4,111-case representation lab likewise records 221 plain-f32, 129 high/low-translation, and 915
break-anchor final-bit mismatches. These results prove that an additive run representation cannot preserve the former
absolute-fold bits universally; they do not make additive placement invalid once its different final numeric contract is
declared and measured. The active resize case alternates
420 and 434 caller units and rejects every zero-patch sample; Latin, dense-CJK, and bidi smoke runs all published on every
measured update. M1 remains open for boundary replacement, browser pixels and fetch cost, and admission of the re-pinned
numeric ABI.

The optimized proof artifact is 1,205,308 bytes, 43 bytes above the frozen baseline despite no production-path source
change. A same-driver A/B/B/A active-resize check measured baseline medians/p95s of `3.588/3.699` and `3.618/3.790 ms`
versus proof `3.620/3.765` and `3.615/3.747 ms`; that is flat within run spread, not a speed claim. Instruction/code-size
admission remains part of the completed M1 gate rather than being inferred from cfg isolation.

The later M1 proof recorded a lower bound without selecting the production ABI. Post-narrow
line-relative and observable-slice-relative reconstruction was bit-exact for 332 published x/y coordinates across 166
real Latin, CJK, bidi, justified, combining-mark, and mixed-size glyphs. Its 14 lines and 18 observable slices include a
two-glyph cluster and a font-size boundary; cancellation and finite-f32 rejection controls remain visible.
That is only a normal-range f32 lower bound; it does not override the f64 inline and block reassociation
counterexamples. Installed Three 0.185.1 compiles branch-free nested occurrence-map lookup for whole-resource 3x10,
2x16, and u32 map specializations through both storage WGSL and WebGL2 PBO GLSL as one instanced-mesh representation. The
direct TypeGPU proof compiled only a standalone extra placement group; production rejects that fifth-group shape because
scene, raster, pose, and paint already consume the four guaranteed groups. Direct TypeGPU is still a proof-of-concept,
and its current eight vertex inputs are an implementation choice to replace rather than a shared-engine constraint.
Actual TypeGPU renderer storage ownership, callback pressure, pixels, and draw behavior remain mandatory M1 evidence, as
do browser pixel/fetch evidence and boundary replacement.

The visual mapping proof intersects source-monotone fragments with retained runs, validates safe cluster boundaries,
and consumes each selected non-hard-break cluster exactly once in explicit L1/L2 order. Multi-glyph clusters retain
internal glyph order, glyphless clusters retain ownership, and 4,096 homogeneous CJK clusters remain one run while
fragment slices and copy spans stay compact. A joined oracle test feeds the independent multi-fragment bidi and hanging
plan into this mapper. Boundary replacement is rejected until replacement occurrences have one explicit owner.

M1 established the topology, numeric counterexamples, and renderer feasibility evidence. An incomplete indexed M2/M3
candidate preserved draws but remained slower while still publishing glyph-wide coordinates; that result rejected the
implementation, not indexed placement itself. The production candidate retains run-local geometry and compact placement
segments, assigns each rendered glyph one engine-owned u32 `placementSlot`, and publishes one root-scoped f32x2 session
row per active segment. Codec authors do not declare the slot, table, or backend memory layout. Batches, physical
instances, order indirection, primitives, spans, and draws remain unchanged. A corrected 21,805-glyph Latin resize smoke
published 3,903 rows in one 31,224-byte session-table patch with zero placement-slot and zero static/raster writes. That
authenticates the compact dirty shape. The next retained-CPU checkpoint precomputes stable word/run roots once per
cluster and replaces its per-rendered-glyph segment-index lane with one instance count per compact segment. An exact
A/B/B/A against branch parent `2b6d5eb3` is positive for all measured resize paths: justified Latin −6.7% median,
mixed bidi −1.9%, ordinary Latin −1.7%, and dense CJK −0.7%, with identical publication bytes. A 202-sample cold check
limits median cost to +0.4% Latin and +0.5% CJK. A later same-machine A/B/B/A used freshly fetched `origin/main`
`ee56fa48` and candidate `8221aa87`, 20 warmups plus 101 measured updates per pass. The main tip has the exact
`20942436` shaper bytes because its intervening change is README-only. Pooled ordinary Latin improves 32.3% median and
32.7% p95, dense CJK improves 24.5%/24.6%, and justified Latin improves 2.6%/11.1%; publication falls from
174,440–175,824 bytes to 31,224–109,200 bytes. Mixed bidi remains the explicit failure: 11.5% median and 10.9% p95 slower
despite reducing publication from 176,352 to 35,856 bytes. This closes the earlier fresh-main attribution, not the final
performance gate. The lazy-absolute-semantic checkpoint subsequently removes the mixed-bidi CPU regression: two final
101-sample passes after 20 warmups pool to `3.437 / 3.491 ms` median/p95 versus the recorded fresh-main
`3.953 / 4.071 ms`, while preserving the compact 35,856-byte publication. Ordinary Latin, justified Latin, and dense
CJK also remain faster at `1.562`, `2.229`, and `2.277 ms` pooled medians. One justified pass contained host stalls, so
its independent clean `2.189 / 2.210 ms` pass is the p95 evidence. The complete browser/editorial matrix subsequently
passes all 120 Presentation cells across both shader stacks, WebGPU/WebGL2, and Bitmap/MTSDF/Slug while preserving
workload draw topology. Editorial holds exactly three draws and measures `0.990–1.710 ms` median reflow. The dedicated
direct-TypeGPU WebGPU gate and reviewed release-size check also pass, so M8 is closed.

## Compatibility with the merged engine

This is a factoring of the post-shaping positioning/publication tail, not another text engine. Preserve these merged
authorities unchanged unless an independent failing oracle requires a correction:

- font loading, fallback, shaping runs, Unicode analysis, HarfRust unsafe boundaries, and stable glyph/cluster IDs;
- `ClusterArena`'s f64 advances, wide fixed-point fit lane with 16 fractional bits stored in i64, sparse word-break
  sidecar, chunk summaries, negative-advance rules, and word/character/no-wrap selection;
- primary-face line metrics, tight explicit line height, hanging spaces, ellipsis boundary shaping, and sequential flow
  regions;
- scoped paragraph ordering, semantic/render-order separation, fixed paint layers, batching, and draw coalescing;
- independent lifecycle/text/style/geometry invalidation, speculative query adoption, A/B commit/abort, borrowed
  publication, renderer acknowledgement, and bounded detached-query ownership;
- Codec resource/program semantics, plan diff/range packing, retained GPU buffers, dirty uploads, unit quads, custom
  material augmentation, and package export/optional-peer boundaries; and
- authoritative measurement, Box3 bounds, caret/selection, and callback-bounded glyph inspection semantics.

The cutover splits current positioning into topology-time glyph-local preparation and geometry-time `LayoutRunSlice`
placement. A `LayoutRun` is deliberately larger than a word or break: it is sliced at shaping-safe cluster boundaries
when line composition places it. This replaces width-triggered absolute per-glyph positioning, absolute-origin change
comparison, and the corresponding glyph-wide publication without turning dense CJK into one run per cluster. The old
path remains a test/lab comparison oracle until the replacement passes the declared numeric and pixel gates, then is
deleted rather than retained as a hidden compatibility path.

The numeric history constrains the domains that remain upstream of final placement; it is not an invitation to move
origins into integer space. The merged
engine retains cluster advances in f64, mirrors them as wide fixed-point values with 16 fractional bits stored in i64 for
authoritative fit and exact justification decisions, advances an f64 glyph pen, resynchronizes that pen from the f64
cluster advance after each cluster, and narrows each final published origin once to f32. An F26.6 fit lane landed earlier
and was superseded by PR #134 because six fractional bits visibly displaced small Three world-space text; the f64
positioning pen remained throughout. This plan preserves `i64` wide-fixed-point fit/distribution and `f64` shaping,
advance, pen, cluster-resynchronization, local-geometry, and slice-placement computation. It deliberately changes only the
last composition: local and placement values narrow independently, and their specified `f32` operations define public and
renderer coordinates. Integer glyph or run origins are not part of the cutover.

## Existing flow-geometry authority

Polygonal editorial flow is not a new layout engine. The Rust core already retains rectangle and polygon regions,
rectangle and polygon exclusions, exclusion margins and wrap sides, multiple disjoint inline slots on one band, and
sequential regions. Production composition already emits multiple same-baseline `FlowFragment` records around a hole.
The private retained planner and the shared public `GlyphTextState` surface can now encode this geometry in one request.
Public `TextFlow` descriptions use ordered stable-keyed rectangle or simple-polygon regions and exclusions in
paragraph-local inline/block coordinates; the configured integration binds them to the paragraph transform before the
retained planner boundary.

The frontier therefore preserves `FlowGeometryArena` as the sole slot-subtraction authority and adds the missing
ownership around it:

- stable package-minted region, exclusion-source, and flow-binding IDs plus generations, independent of array position;
- per-entity geometry revisions and one shared bounded vertex pool;
- zero exclusion allocation/capacity for flows with none; on the first exclusion, retained `Vec` arenas reserve capacity
  for 16 bindings/entities, then grow geometrically and retain their high-water allocation; this is an allocation policy,
  not an API count limit or a new inline-container dependency;
- a separate lazy, geometrically growing slot-output/scratch capacity; exclusion entity capacity and the number of
  disjoint slots one band can produce are never represented by the same limit;
- public/config-owned rectangle and bounded-simple-polygon authoring;
- fragment-relative invalidation and forward convergence after one obstacle changes;
- a Three-owned projector from known 3D geometry to canonical 2D layout-space exclusions; and
- a same-source drop-cap entity that produces both an anchored display run and an exclusion.

Geometry descriptors should use dense component lanes for identity, generation, revision, kind, bounds, vertex range,
margin, and wrap policy. Polygon vertices should remain interleaved inline/block pairs unless a focused kernel proves
SoA faster; each band intersection consumes both coordinates together. The rectangular/no-exclusion path remains a
separate homogeneous loop and must not acquire a polygon branch in its hot traversal. A polygon is one implicitly
closed simple ring with at least three distinct finite vertices, no consecutive duplicates, no self-intersection, no
holes, and nonzero signed area; normalize winding at admission. Concave region rings retain the existing exact
even-odd section intersection. Concave exclusions retain the existing conservative single inline hull over each line
band rather than pretending to preserve holes in the occluder.

Separate authored scene identity from flow-local layout data. A scene-level `ExclusionSource` owns the stable object ID,
generation, and world-silhouette revision. A `FlowExclusionBinding` owns one source/flow relationship, its own generation,
and its projected layout-local polygon, bounds, margin, wrap policy, and projection revision. Each flow retains a compact
dense binding range. A linear cache-local scan is the default through the initial 16-binding reservation and beyond; admit a
block-sorted candidate/band index only after attributed measurements establish that scan's material cost and crossover.
Source-to-binding adjacency is the only reverse edge. The hot line loop never searches a global scene registry or follows
renderer object pointers. Exclusions do not point at runs: geometry produces slots first, then composition assigns run
slices.

Geometry, bindings, the vertex pool, candidate index, and resulting flow layout use the existing `Staged<T>`
commit/pending discipline. Prepare every source update, binding insertion/removal, vertex-range replacement, and index
change in pending state; publish it with the matching layout transaction or abort it together. A removed binding becomes
a tombstone until neither committed nor pending state references its generation. Binding IDs and vertex ranges may be
reused only after transaction retirement and renderer acknowledgement. Growth is fallible and happens before mutation;
an entity, vertex, or produced-slot global ceiling returns `ResultTooLarge` and leaves committed state untouched. Never
silently drop an exclusion or a slot to fit a capacity.

## Core data model

Use small, phase-owned component arenas with dense structure-of-arrays storage. Stable IDs describe identity; compact
active arrays and queues describe work. No optional feature union belongs in the innermost glyph or cluster loop.

### Retained shaped glyph components

Keep the existing shaped glyph/cluster authority and add only data that remains valid across width changes:

- glyph ID, cluster/source range, style/font/raster identity;
- run-local f64 advances, glyph offsets, and cluster-prefix resynchronization points, with the existing wide fixed-point
  mirror with 16 fractional bits stored in i64 retained only for fit and exact justification decisions;
- anchor-local glyph origins and ink derived in f64, then narrowed into retained f32 local components at the declared
  final-placement boundary;
- local ink bounds and raster extent;
- advance and shaping offsets;
- a stable `LayoutRun` slot, fixed break-independent numeric-block ordinal, and run-local cluster/glyph ordinal; and
- static gap identity only where inter-character expansion is permitted.

The static glyph-to-run mapping is published when shaping topology changes, not on width changes. Fragment/line
membership is dynamic slice data and cannot be baked into a static glyph record.

### `LayoutRunArena`

One stable run entity owns:

- cluster range and contiguous glyph range;
- local advance, fixed break-independent numeric anchor blocks with two-dimensional anchors, and range-queryable
  local-ink chunk summaries;
- paragraph-resolved/base bidi run identity, shaping direction, and shaping-time internal glyph order;
- geometry/shaping identity such as selected font face, size/variation/features, and spacing inputs;
- source kind (`paragraph-source` or a distinct shaped `boundary-replacement` while that topology exists).

Split a run only at a boundary that invalidates local glyph geometry or shaping-time order: a shaping/font-geometry
change, paragraph-resolved bidi shaping run/direction change, or boundary replacement. Paint/material/raster/decorating
group changes produce renderer or decoration spans over the same run and never churn placement topology. A
script boundary that has already been shaped does not itself split a placement run when resolved direction, bidi level,
selected font, and shaping/layout style remain compatible; exact per-cluster direction and shaped payload remain part of
canonical comparison. A
HarfRust-unsafe edge is forbidden as a slice boundary, not a reason by itself to split the run; a run may span it. Legal
word and character breaks do not themselves create retained runs. In dense CJK, one large run therefore spans many legal
break opportunities and is sliced only at safe cluster boundaries by composition. Do not encode topology conditions as
booleans tested for each glyph during placement.

A boundary replacement owns a distinct shaped `LayoutRun`, its glyph-local records, and its numeric blocks for exactly
the committed topology lifetime in which it exists. It does not borrow a zero-glyph slice or placement identity from the
paragraph-source run whose text it replaces. Creation, replacement, removal, abort, and renderer-acknowledged retirement
follow the same staged ownership rules as paragraph-source runs.

### Placement segments and visual spans

One dynamic placement segment identifies a contiguous cluster/glyph subrange of a `LayoutRun` placed with one exact
inline/block translation. CPU SoA lanes retain run identity, canonical revision, run-local cluster and glyph spans,
stable segment anchor, and numeric-block ordinal. Separate visual spans retain final-line, hard-break, hanging,
replacement, line-resolved L1, and L2 ownership. Justification quotient/remainder and ordinals remain in the existing
CPU composition state; none of this metadata enters the renderer placement row.

The placement unit is the nonempty intersection of one source slice, one fixed numeric block, and one stability-aware
visual segment after L1/L2. Sparse prose retains safe word-root segments from the existing word sidecar even when adjacent
segments currently have equal translations, so the same stable segmentation survives movement across lines, exclusions,
and justification. Split inside a word only for an actual displacement or boundary change. Dense CJK retains large
`LayoutRun` topology and uses fixed numeric blocks plus current visual segments, never one run per glyph.
The existing positioning traversal computes these segments while it performs the authoritative cluster walk; there is
no parallel glyph-positioning pass or placement-class queue. This split is placement metadata only: it does not create a
retained run, static glyph rewrite, batch key, or draw.

Each slice caches the ink union for its local glyph range. Derive it from immutable run chunk summaries plus bounded
edge scans, so a partial CJK run does not force a whole-run bound or a broad per-glyph measurement walk.

The renderer mapping keeps stable glyph identity separate and adds one engine-owned u32 placement slot for each physical
glyph occurrence. Stable-indirect draws keep their existing logical-to-physical order lookup; ordered-direct draws keep
their existing physical instance. The adapter then resolves `placementSlot[physical]` into the root-scoped f32x2 session
table. This preserves the existing visual-order stream and draw topology. Source slice/block intersection count and L2
copy-span count are reported separately: an RTL or mixed-level source intersection can require multiple copy spans even
when it uses one translation. Reject any candidate that requires one draw per run/slice or a branch/search over line
breaks in the ordinary vertex path.

Keep paint/material/raster grouping outside `LayoutRunArena`. Existing codec/resource batch spans reference run-local
glyph subranges and are intersected with visual slice spans during plan publication. A paint-only update rebuilds those
render spans and program resources, but preserves run IDs, run-local geometry, slices, and placements whenever text and
geometry are unchanged. Decoration spans remain separate line-owned entities.

### Indexed occurrence placement

Every active placement segment receives exactly one engine-owned 8-byte translation row, and every rendered glyph
occurrence receives exactly one u32 slot selecting that row. The generic Codec surface exposes semantic placement, not
physical buffer declarations or slot allocation: package-private host assembly writes the slot and adapters own its
physical lane or packing. Justification has no renderer sidecar, mode, or wider row.

The universal row is:

```text
translation_x: f32
translation_y: f32
```

Do not derive static local coordinates from a visual slice: width changes move CJK and other dense content across slice
boundaries and would turn the proposed optimization back into broad static-glyph rewrites. The exact anchor scheme remains
evidence-gated. An admissible bounded-local design may partition one `LayoutRun` into fixed, break-independent numeric
anchor blocks owned by that run. Numeric boundaries are allowed at stable cluster or glyph adjacencies, including a
`CLUSTER_SAFE_BEFORE`-false edge: they neither reshape nor authorize a line break. Composition slices still require a
shaping-safe cluster boundary.

Build each block from a running two-dimensional geometry envelope, not total advance or endpoint prefixes. The scan uses
the run's direction-canonical glyph order and includes every glyph cursor, negative-advance excursion, cluster-prefix
resynchronization, x/y shaping offset, baseline shift, semantic origin, and ink start derived from glyph extents. It also
includes any ink corner formed locally before translation. A freely chosen f64 `(anchor_inline, anchor_block)` must bound
every translated local coordinate admitted to the block. The selected contract must explicitly handle a single glyph
whose required envelope exceeds its bound; it may revise the bound or representation, but it may not silently use an
absolute fallback or second materializer.

Dynamic source slices intersect numeric blocks and stability-aware L1/L2 visual segments to publish the placement
occurrences defined above. Sparse prose reuses retained safe word roots; only real intra-word displacement or boundary
changes subdivide them. Dense CJK uses fixed numeric blocks and current visual segments without manufacturing word,
run, or per-glyph placement entities. A numeric block is not a second run identity, line entity, batch key, or draw key.
A warmed width update with unchanged text, font/local geometry, and boundary-replacement topology may rewrite dynamic
occurrence and placement rows but must write zero bytes to static glyph-local/numeric-block buffers.

The final coordinate contract is re-pinned to the additive representation. For an ordinary coordinate, the normative
operation sequence is:

```text
local_f32       = round_ties_even_f32(anchor_local_f64)
translation_f32 = round_ties_even_f32(occurrence_translation_f64)
final_f32       = round_ties_even_f32(local_f32 + translation_f32)
```

CPU semantic publication, measurement, hit testing, glyph inspection, and every renderer must use that sequence; no
consumer may preserve the former absolute-fold result or substitute algebraic reassociation.
`occurrence_translation_f64` includes the selected fixed numeric anchor and any cumulative justification displacement
computed by the CPU for that source-slice/block/visual-segment intersection. The CPU retains exact `i64`
quotient/remainder and ordinal state. Sparse prose preserves safe word-root placement segments and subdivides a word only
where cumulative displacement or a boundary actually changes; dense CJK follows fixed numeric-block and current-visual
segment boundaries. The CPU then narrows each segment's ordinary x/y row. Every renderer uses the same ordinary operation
sequence above; it never receives justification arithmetic or metadata.

The wide fixed-point fit and justification lanes do not become origin storage, and `f64` remains authoritative before
these declared final narrows. If admission bounds one local scalar to `abs(local) <= 8,192`, binary32 round-to-nearest-even
bounds that local conversion alone to `1 / 4,096` absolute error; it does not bound translation narrowing or the final
addition. Freeze and test three separate limits: local-narrow error against its f64 input, translation-narrow error at the
admitted world-coordinate range, and final-add absolute/ULP error after the declared operation sequence. The existing
inline/block reassociation controls and the 4,111-case representation lab measure the deliberate delta from the former
absolute-fold contract rather than demand old-bit parity. Before enabling the cutover, reject new non-finite results and
pass tiny-world, cancellation, large-coordinate, justification, and browser pixel gates without post-hoc bound widening.
The old absolute result is only an independent comparison oracle for those gates; a failure blocks or revises the new
single contract and never activates a compatibility materializer.

The 8-byte session row is the universal renderer representation, subject to those admission gates rather than another
compact encoding search. Break-anchor and high/low experiments remain negative evidence about old-bit preservation, not
alternate production modes. Visual starting ordinals, class, role, bidi level, block ownership, and exact justification
inputs live only in CPU SoA lanes used to produce rows and visual spans.

The u32 occurrence lane follows the lifetime and physical addressing of the existing glyph record. The planner-scoped
placement allocator owns row identity, generation, abort/commit, and acknowledgement quarantine independently of stable
glyph identity. Row sharing is root-scoped: glyphs split across resource or material batches may select the same placement
row without duplicating it or changing a draw key.

### Visual line and decoration components

Maintain compact visual-run spans per line: a line references a range of run IDs in visual order. Preserve a
copy-span representation where unchanged runs can be copied without deciding order per glyph. The current stable
indirect ordering path remains the correctness fallback for non-contiguous or reordered spans.

Decorations are separate entities, one per continuous decorating group per visual line. Each holds a line-relative rect,
paint program, depth layer, and run-span provenance. They remain unit-quad instances and do not cause glyph
geometry regeneration.

## Phase boundaries without duplicate placement

Keep the existing explicit composition, boundary-shaping, bidi, decoration, and publication phases, but do not add
parallel ordinary/justified placement queues. The one positioning traversal already owns the exact pen, justification,
L1/L2, hanging, boundary, semantic, and glyph-emission order. It records placement segments and visual spans as compact
side effects of that walk. Raster technique remains absent from positioning, while role and bidi metadata remain absent
from the placement translation row.

Classify word/character/no-wrap composition before the walk, derive boundary replacement and line-resolved bidi state at
their existing phase boundaries, then publish placement and visual-order changes independently after positioning.
Retained lines may compact-copy and rebind their segment/span ranges; failed compact validation returns to the same
positioning traversal rather than a second rematerialization algorithm.

Line composition may remain serial where a prefix sum determines the next legal break. It should operate on word/break
records, not glyphs. Dirty comparison and publication of the resulting placement rows are independent dense passes and
are the initial SIMD candidates; placement arithmetic itself retains one authority.

## Required typography behavior

### Word and character wrapping

For word wrapping, keep legal UAX #14 opportunities intersected with the existing UAX #29 and HarfRust-safe cluster
boundaries as a sparse break sidecar over large topology-defined runs. Moving a line break updates run slices, line
membership, translation, and visual order. Glyph-local records remain unchanged.

An oversized unbreakable span enters `compose_character_queue`. That system slices the same large run at existing safe
cluster boundaries and patches only the affected slice/break mapping; it does not manufacture retained per-cluster runs.
Dense CJK uses a dense safe-boundary bitmap or cluster-index range already owned by `ClusterArena`, not a sparse word
record per cluster. The M1 proof must show, for every selected break, the exact mapping
`(LayoutRunId, local cluster range, local glyph range) -> LayoutRunSlice -> visual instance span`, including clusters
with multiple glyphs, zero glyphs, ligatures, combining marks, and RTL glyph order.

### Bidirectional text

Split stable runs on paragraph-resolved shaping bidi-run/direction boundaries, never on line-resolved L1 changes. A
same-baseline group of disjoint slots is one logical `FlowLine` with one ordered list of `FlowFragment` occurrences.
Geometry stores slots in ascending physical inline order. Source content is consumed through those slots in
paragraph-base order: ascending for LTR and descending for RTL. The fragments retain that logical consumption order even
if paint spans are later stored in physical order.

After composition, prepare resolved levels once over the full logical line source range and index every fragment against
that same line start. Apply UAX #9 L1 to that full line, then apply L2 independently to each fragment's contiguous source
range; a hole is a layout fragmentation boundary and cannot reorder glyphs across itself. This explicitly fixes the
current second-fragment defect where a level array based at the first fragment is indexed using the later fragment's
start. Validate the correction against an independent UAX #9 implementation, not the old positioned output. Stable runs
retain topology and direction, not a line-independent resolved level. Internal glyph order stays local to its run.

Trailing whitespace whose level resets at the logical line boundary is a distinct hanging-space slice occurrence and is
attached to the fragment containing the logical line end. Mixed-direction lines may therefore update occurrence levels,
translations, and order spans when width changes even when glyph-local geometry is unchanged. Within each fragment,
visual spans paint in UAX #9 order; fragments paint in ascending physical inline order, with the existing stable
semantic/render-order tie-breaks. Draw order is not optional: combining marks, overlaps, and custom materials must retain
the same visual paint result as the independent oracle.

### Justification

Word-space justification moves following segment roots; it does not rewrite glyph-local origins. Store static gap
identity with glyph-local data, then evaluate the visual starting ordinal and exact wide-fixed-point quotient/remainder
in CPU composition state scoped to one `FlowFragment`:

```text
ordinal * quotient + min(ordinal, remainder)
```

The existing cluster traversal evaluates the expression above and writes ordinary f32x2 x/y offsets through the
stability-aware segmentation rule: retain safe word-root segments even when adjacent translations match, and split within
a word only at an actual displacement or boundary change. The indexed occurrence placement does not change draws or raster
programs. Because inter-character expansion moves glyphs inside a run, the justified query kernel must publish a
post-expansion ink summary or walk that specialized segment; translating a pre-justification summary is not sufficient.
Quotient/remainder and ordinal zero reset independently for every fragment. The final-line decision is made once for the
logical `FlowLine`, so a nonterminal slot is never mistaken for a paragraph-final line. Final-line, inter-character, and
script-specific justification policies select CPU queues before traversal; renderer program selection remains solely a
raster/material concern.

### Hanging spaces and line measurement

Hanging spaces remain in semantic/source ranges but are excluded from visible line advance and justification input as
required by the current contract. A separate slice occurrence prevents end-of-line behavior from mutating its retained
layout run.

Line measurements and paragraph bounds derive from fragment summaries and placements. They must not materialize every
glyph. Ink bounds use the union of translated run-local ink summaries, plus decoration bounds where the public
measurement contract includes them.

### Decorations

Rebuild only continuous decoration spans whose line membership or endpoints changed. Preserve under/content/over depth
ordering and style discontinuities. A future skip-ink policy must consume retained local ink intervals in core; adapters
must not scan glyphs to derive it.

### Editorial regions, exclusions, and local convergence

Retain `FlowGeometryArena`, `InlineSlotArena`, and `FlowLayoutArena` as the only region, slot-subtraction, and convergence
authorities; strengthen them instead of adding parallel systems. Its edit and exclusion entry paths share eligibility,
flow/drop-cap context, retained-suffix publication, and font-resolution inputs while preserving their distinct stopping
rules. Compare committed
and pending geometry by stable entity ID, generation, and revision. Build the ordered block intervals affected by the
union of every changed binding's old and new bounds, including margin. Preserve the prefix before the earliest interval.
Recompose forward, but do not test convergence before the dirty horizon—the end of the last affected interval or later
geometry event—has been crossed. This prevents an unchanged band between two changed portions of a concave polygon from
certifying a stale suffix. At or after that horizon, stop only when this convergence certificate matches the retained
suffix:

- next stable source cluster and flow-thread identity;
- region ID, block cursor, baseline, line height, and paragraph spacing state;
- ordered inline-slot sequence, slot geometry revisions, and `FlowFragment` origins;
- break, hanging-space, boundary-replacement, line-limit, and ellipsis state; and
- `LayoutRunSlice` occurrence order and placement at the suffix boundary.

If the certificate never matches, reflow to the end. Cold rebuild remains the exact oracle. This is a flow-geometry
system layered before layout-run placement, not a geometry condition inside shaping or the ordinary placement loop.
Unchanged obstacle projection must write no geometry records and trigger no Wasm crossing.

Justification is scoped independently to every produced `FlowFragment`. Its quotient/remainder and ordinal base reset
for each disjoint slot, while final-line policy follows the logical `FlowLine` rather than accidentally treating every
slot as a paragraph ending. Slot consumption follows the paragraph base direction defined above; bidi resolution and
paint order remain properties of the fragment/visual-span pass, not geometry traversal.

### Projected 3D obstacles

The core consumes only canonical 2D layout-space polygons. Three owns projection because cameras, object transforms,
clipping, and the text plane are renderer concerns. The helper accepts caller-known conservative object bounds or an
explicit simplified CPU silhouette plus the text object's planar local-to-world transform and flow bounds. It rejects a
noninvertible transform, a camera on the text plane, and a degenerate/edge-on text-plane projection rather than emitting
nonfinite geometry.

Projection produces a value; it does not assign exclusion membership. The application explicitly attaches that value to
each selected paragraph region, projecting separately into each Text-local frame when necessary. The same world object
may therefore reflow one column, be omitted so another column renders behind it, or use independently transformed copies
without the renderer inferring policy from geometric intersection.

For a bounds volume, transform its faces to world space, clip them first to the camera-side half-space of the oriented
text plane and then to the camera frustum including the near plane, and project the surviving vertices/edge
intersections to NDC. Thus an object wholly behind the text plane or camera contributes no exclusion; an object crossing
the text plane contributes only its camera-side portion. For each surviving NDC point, construct the perspective camera
ray or orthographic parallel ray, intersect that ray with the text plane, and transform the finite intersection into
text/flow-local coordinates. Take a conservative convex hull for bounds input; an explicit silhouette may retain a
validated simple concave ring. Clip to the authored flow region, inflate by declared projection error and layout margin,
simplify without moving the boundary inward, then quantize. Update one stable `FlowExclusionBinding` only when the
quantized polygon or projection inputs change.

There is no depth-buffer, coverage-mask, GPU readback, or claim of hidden-surface exactness. The declared policy is
camera-to-text-plane occlusion, not arbitrary scene visibility. Near/frustum/text-plane crossings must remain finite and
conservative. Moving the object, text, or camera is renderer-only work when the quantized layout-space polygon is
unchanged. Projection, clipping, serialization, Rust slot resolution, reflow, publication, and submit are reported as
separate phases.

### Drop caps

A drop cap remains part of the same source paragraph. Begin with one complete extended grapheme, then extend its source
range to a HarfRust shaping-safe cluster boundary (`CLUSTER_SAFE_BEFORE`) without splitting a ligature or dependent
cluster. If no bounded safe edge exists, conservatively disable the cap or shape the authenticated larger prefix; never
split the EGC or guess a glyph boundary. Shape that selected prefix once through its authored font/style/raster program,
anchor its display run to the first region, exclude the exact selected source range from body flow, and emit a
conservative exclusion before composing the remaining clusters.

The cap and body retain one source-coordinate domain. The cap entity records selected UTF-16 range, cluster range,
display-run ID, body-resume cluster, and source-to-display mapping. Caret, selection, hit testing, `withGlyphs`, and full
glyph inspection merge the two realized ranges without duplication or omission. Local edits recompute the safe boundary
transactionally. The initial model specifies cap height in lines, baseline/cap alignment, margin, side, and optional
caller-authored polygon. Raster program is per display run, so a Slug cap beside Bitmap or MTSDF body text shares core
layout and source mapping without adapter-owned realization logic.

The first production slice uses transformed glyph/design bounds or an explicit caller-authored contour normalized over
that generated exclusion box. The contour preserves the existing height, alignment, logical-side, and margin controls;
the core conservatively projects its intersection with each body-line band into one logical-side inline cut. Outline-tight
automatic flow is separately evidence-gated because the retained shaping artifact does not own contour points. Arbitrary
rendered-pixel occlusion remains out of scope.

The Editorial acceptance scene combines a stylized same-source drop cap with justified columns and a moving 3D object.
The object repeatedly approaches, intersects, passes through, and exits the text plane so its projected polygon changes
topology and creates zero, one, or multiple inline slots. The scene must visibly prove continuous reflow, source
continuity, mixed-raster alignment, and recovery to the original layout after the obstacle leaves.

### Hit testing and glyph inspection

Resolve hit tests as line -> physical fragment -> visual slice -> local cluster/glyph. A run-local prefix/index may be
built lazily for a queried line, but ordinary rendering and measurement must not allocate it.

`withGlyphs(callback)` remains the zero-whole-copy inspection API. It composes an individual absolute result into the
existing fixed Wasm scratch from slice placement plus local glyph data. `glyphs()` and `breakApart()` may explicitly
materialize caller-owned arrays because the caller requested a full copy; they are not resize hot paths. Query results
must remain synchronous, lifetime-bounded, and invalid after the callback.

Milestone 12 adds the distinct `transformGlyphs(callback)` live deformation boundary while preserving
`withGlyphs(callback)` as a generic read. Returning one transform for every glyph in the borrowed layout installs or
updates a presentation override for that exact accepted topology; a different length, an expired view, reentry, or
non-finite transform rejects atomically. The logical API exposes glyph-indexed local, paragraph, or world-space
transforms rather than buffer lanes or shader layouts. Adapters pack the result into renderer-owned dirty ranges and
compose it after the ordinary run/segment x/y placement, so a physics tick can update only overridden glyph transforms
without reshaping, changing batch or draw topology, or republishing unchanged raster data. Full 3D
position/rotation/scale or matrix transforms are part of the acceptance surface, not a Three-only snapshot convention.

An accepted topology change replaces the positional index mapping and causes the next callback to observe the new glyph
count and order. Transform index `i` then applies to whichever glyph occupies index `i`; removed trailing indexes retire
their overrides and newly appended indexes require new values. Core does not infer semantic continuity from glyph IDs,
clusters, or source characters. An application that needs a physics body or authored object to survive arbitrary middle
edits supplies and reconciles its own document-domain keys outside this positional API. Live deformation stays attached
to the source `Text` lifecycle. `copyGlyphs()`/`breakApart()` remains the
complementary ownership boundary: it copies already-shaped glyphs into an independently owned object that no longer
follows text shaping, layout, or topology updates. Presentation deformation does not feed line breaking or exclusions
back into layout unless the application separately authors corresponding flow-region geometry.

Three's accepted implementation uses absolute affine `Matrix4` glyph frames. A bare matrix array is Text-local; the
structured result can name paragraph x-right/y-down, Text-local, or world space. It lazily adds renderer-owned mat4
storage only after the first transform result, refreshes material/display-list identity once, and thereafter marks only
the changed 16-float physical-record ranges. Stable-slot ownership prevents a reused record from inheriting a prior
glyph's matrix. `measureGlyphs()` resolves the same matrices for interaction geometry. TypeGPU remains read-only here
until its proof-of-concept adapter demonstrates an equally explicit storage, shader, and browser lifecycle.

Migrate `snapshotGlyphOrigins` and the Three `glyphPlacements` path in the atomic cutover. Bounds, raycast, caret, and
selection must resolve through the core line -> fragment -> visual slice -> local glyph query authority, not a renderer
snapshot/cache of absolute origins. A renderer may cache GPU resources, but it may not become the semantic placement
source. Compare these public methods before/after render, after width change, and after commit/abort.

## Publication, shaders, and renderer ownership

### Zero-copy and double buffering

Keep the current synchronous borrowed A/B publication contract. `FlowGeometryArena`, flow-local binding/index storage,
`FlowLayoutArena`, run slices, and placement/order/decoration state all participate in one pending transaction. Rust
writes inactive pending state, exposes a lifetime-bounded borrowed publication, and promotes the entire graph only on
successful commit. Abort/retry leaves the committed graph and every generation reachable from it unchanged. Removal
tombstones an entity in pending state; binding IDs and vertex ranges are reusable only after no pending or committed
reference remains and renderer publication acknowledgement retires the old generation.

This does not claim that a GPU reads Wasm linear memory directly. GPU upload is unavoidable. After the single-system
numeric cutover, the invariant is no extra full intermediate copy: a width update with unchanged text, font/local
geometry, and boundary-replacement topology writes and uploads compact placement/order/decoration patches and writes zero
bytes to the static glyph-local/numeric-block buffers.

The proof identity foundation is concrete: each paragraph receives a nonwrapping incarnation, each `LayoutRun` receives
an exact non-hash canonical revision after complete retained-content comparison, and a planner-scoped dense slot arena can
validate split/merge and retirement behavior. It remains test/kernel-lab state until publication requires stable run
handles; release width updates do not perform this reconciliation. The first cluster's stable text-unit ID is only a
reconciliation anchor, never a physical slot or globally comparable handle.

Do not zero-scale unused capacity. The built-ins already use static unit quads with an authoritative instance count;
drawing degenerate slack wastes vertex work and complicates ordering. Reserve capacity and set the live count.

### Codec and ABI cutover

Replace the glyph-wide absolute placement contract atomically. The shipping engine has one retained placement model:
`LayoutRun` plus compact run/line placement under the re-pinned final-coordinate operations above. The old materializer
may exist only behind test/lab compilation as a numeric/pixel comparison oracle and is deleted from production when the
cutover lands; it is never a selectable production mode or an exact-bit compatibility fallback. Retire the test/lab
oracle only at M6 after full matrix closure.

1. Add one engine-owned semantic placement slot for every rendered glyph and one root-scoped f32x2 table row per active
   placement segment. Codec authors produce glyph-local technique outputs and never receive or declare host slot
   allocation, tables, bind groups, or backend memory layout; package-private assembly appends the slot store after
   authenticating the body. The row carries no justification, class, role, bidi, or block metadata.
2. Let each adapter choose the internal physical lane or packing for the u32 slot while retaining one occurrence per
   existing physical glyph record. The shared contract specifies the slot semantics, row values, and operation order, not
   whether the adapter uses vertex attributes, storage, or interleaving.
3. Keep the occurrence lane and shared table outside `BatchKey`, primitive, span, and draw compatibility. Direct TypeGPU's current
   prototype buffer count is measured evidence for that adapter, not a shared limit the core must encode around.
4. Version and regenerate the Rust JSON contract, TypeScript declarations, validators, fixtures, and ABI fingerprints in
   the same commit.
5. Update custom codec/program registration to the new semantic placement contract in the same release. The package is
   pre-alpha, and the deliberately re-pinned final-coordinate contract does not justify shipping two positioning systems.
   Keep the stable-ID contract truthful and hide adapter allocation details behind the engine boundary.

The u32 occurrence slot and root-scoped 8-byte placement row are now implemented in the generated semantic contract and
the Three/direct-TypeGPU adapter paths. Three owns its retained PBO/storage form and direct TypeGPU owns an adapter-local
storage layout. Exact justification arithmetic remains CPU SoA state that produces ordinary x/y rows. Internal retained
positioned semantic state keeps local origin/ink values plus its placement-segment index; public semantic/query output
and CPU/plan bounds materialize absolute origins only at their read edge. Raster realization consumes the same f32
operands in the commuted addition proven bit-identical by the deterministic arithmetic corpus. Per-technique browser
realization now passes direct TypeGPU on project Chromium WebGPU and both Three shader sets on WebGPU plus forced WebGL2,
without changing draw/storage identity. The complete 120-cell Presentation matrix, compact transfer-byte assertions,
reviewed release-size check, and final CPU/publication measurements close the cutover gates.

### GPU data access

Static per-glyph instance data contains local origin/ink/size, stable identity, and local ordinal. One aligned
per-physical-glyph u32 lane selects the current root-scoped x/y row; it is dynamic occurrence data, not a batch key or
static run identity. The generic material/resource realizer resolves final position before invoking the raster coverage
graph, so custom material augmentation continues to observe the same final-position semantics.

Every vertex path reads its u32 slot, reads the selected f32x2 x/y row, and performs the same ordered addition. Shaders
do not test or receive wrapping, bidi, decoration, justification, class, role, or numeric-block state. Justified and
ordinary content therefore share the existing raster program and batch; Bitmap, MTSDF, and Slug coverage remain
unchanged.

Before freezing the ABI, prove the chosen aligned-offset realization on both WebGPU and Three's WebGL2 backend. The proof
must identify the actual TSL/GLSL resource form, alignment, update range, and device limits in the installed Three version.
For WebGL2 attributes or PBOs, measure bytes uploaded from dirty active rows and bytes actually transferred when the
backend expands that update to padded width, full row, or full allocated storage; report active and reserved capacity
separately. If WebGL2 requires a linear per-glyph break search or an extra draw per run/slice, reject that representation;
adapters may not silently diverge.

Three TSL and Three TypeGPU-backed shaders already have internal instance-data precedent; measure the incremental fetch
and WebGL2 transfer behavior. Base `/typegpu` must separately prove its chosen storage or attribute ownership,
instance-index access, and buffer-limit headroom before it migrates. It has no decoration renderer today and this plan
does not imply one. No adapter owns a second layout model, and the added offset must preserve existing scene draw counts.

The source audit records that Slug has seven technique records. Both Three and direct `/typegpu` pack `placementSlot` into
the proven-unused `bandCounts.z` lane, retain stable glyph identity as the eighth Codec record, and read the shared x/y
placement table from scene-owned storage. TypeGPU binds the seven raster records as vertex inputs; its stable-ID record
remains a CPU/publication identity rather than a vertex input. Placement therefore adds no texture, ninth Codec buffer,
vertex layout, bind group, or draw split. Adapter-local packing remains below the shared Codec-authoring contract. Three
and direct TypeGPU currently realize each display-list span as a draw, so slices cannot become spans. M1 prices the chosen
slot/table transfer, including Three WebGL2 PBO padding.

## Milestones and commit boundaries

Work in coherent, reviewable feature gates. Each commit must preserve its named invariant and pass focused deterministic
checks, but the full evidence gauntlet runs at the end of each stack rather than after every commit. Push checkpoints to
the remote under a draft PR so work is recoverable and reviewable; do not mark the PR ready until the stack-level
correctness, package, browser, performance, and documentation gates all pass.

### M0 — freeze and attribute the exact baseline

- Fetch remote `main` again and rebuild its exact `origin/main` result with the pinned toolchain; record commit, tree,
  Wasm, and benchmark-driver hashes.
- Add benchmark/lab-only phase accounting for line fit, run/glyph positioning, boundary shaping, decorations,
  semantic query, codec gather, plan diff, and publication; record records and bytes, not wall time inside production.
- Add maintained `active-column-resize`, `justify`, `bidi-resize`, and `equivalent-width` cases plus Bitmap/MTSDF/Slug
  CJK fixtures before using those lanes as gates.
- Reproduce the 22k width/measurement evidence in three interleaved baseline rounds.

Exit: attribution supports run placement/publication as the dominant removable work. If not, stop and update this plan.

### M1 — test/lab run proof and renderer feasibility, no ABI change

- Build `LayoutRunArena` and placements in test/lab configurations beside the current positioned arena; production keeps
  executing exactly one path.
- Flatten the shadow result through a test/lab adapter and compare topology, measurements, decorations, and visual order
  with current output, except that known multi-slot bidi defects—later-fragment level indexing and
  paragraph-base-direction slot consumption—must match the independent oracle rather than the defective baseline. Record
  final-coordinate differences under the separately declared numeric gate instead of requiring old bits.
- Add an independent UAX #9 oracle and a two-plus-fragment LTR/RTL/mixed fixture that fails the existing later-fragment
  level indexing. Prove full-line L1, fragment-local L2, base-direction slot consumption, physical paint order, hanging
  space ownership, logical final-line policy, and per-fragment justification ordinal reset.
- Scope justification ordinals to each `FlowFragment` and prove justified ink bounds in the shadow oracle; these are
  data-model requirements, not later cleanup.
- Specify paragraph/session buffer ownership, capacity, batch sharing, acknowledgement, and slot retirement before
  freezing record layouts.
- Measure run count, changed placement rows, working-set bytes, and projected publication bytes across Latin,
  mixed-direction, CJK, and justification corpora.
- Prove a break-independent anchor policy. Compare whole-run anchors with fixed numeric anchor blocks owned inside one
  `LayoutRun`; numeric blocks may split at stable glyph/cluster adjacencies independent of shaping-safe line boundaries,
  and visual slices may not define static local coordinates. Admit blocks from the full running two-dimensional
  origin/ink envelope, including negative advances and cluster resynchronization. Record CPU publication bytes and GPU
  fetch cost for each admitted anchor policy.
- Prove the dense-CJK mapping from a large `LayoutRun` through safe-boundary slices to exact visual instance spans for
  multi-glyph, zero-glyph, combining, ligature, and RTL clusters. Record run/slice/span counts and reject one-run-per-break,
  one-run-per-glyph, per-glyph break search, or one-draw-per-slice designs.
- Prove stability-aware source-slice/numeric-block/visual-segment intersections under L1/L2. Sparse prose must retain safe
  word-root placement segments across line, exclusion, and justification movement even when adjacent translations match;
  split inside a word only at a real displacement or boundary change. Dense CJK must use fixed numeric blocks and current
  visual segments without one run or placement row per glyph. Report placement rows separately from copy spans and
  preserve the existing draw count.
- Authenticate the declared local-narrow, placement-narrow, and ordered-f32-add sequence independently in Rust and every
  renderer. Predeclare and measure local-narrow, translation-narrow, and final-add bounds separately; record signed,
  absolute, and ULP deltas from the old absolute-f32 oracle without treating old-bit parity as acceptance. Separately
  prove CPU quotient/remainder evaluation and the stability-aware segment rule over the full justification corpus; every
  segment selects an ordinary f32x2 row.
- Prove explicit replacement `LayoutRun`/numeric-block ownership through boundary appearance, replacement, disappearance,
  abort, retry, publication acknowledgement, and retirement; a zero-glyph attachment to a paragraph-source run is not an
  admitted replacement owner.
- If a candidate uses integer reinterpretation, compile a focused TSL storage-read fixture under Three's installed WebGL2
  backend; its pinned `bitcast_uint_int` helper has an observed return-type mismatch, so source presence is not proof.
- Measure WebGL2 active dirty bytes and padded/full backing-texture transfer bytes independently.
- Rebaseline publication per technique: current geometry-only width writes are 8 bytes/glyph for Bitmap and
  16 bytes/glyph for MTSDF/Slug. Account separately for Wasm retained, CPU staging, GPU static, GPU dynamic, and
  per-update publication bytes.
- Add a render-plan fixture containing a three-line justified Bitmap paragraph and a ragged Bitmap paragraph that share
  font, material, and resource. Its candidate draw count must equal baseline while every ordinary and justified
  occurrence selects the same f32x2 row shape and no renderer justification payload exists.

Exit: CPU semantic/query and renderer results agree exactly under the re-pinned operation order; signed/absolute/ULP
deltas from the old oracle stay inside a predeclared bound; pixel evidence is accepted; bidi is independently correct;
and CJK mapping, per-technique bytes, buffer lifetime, and regression gates pass. Otherwise revise the one new contract
before touching the ABI; do not activate an absolute compatibility path.

### M2 — retained core state beside the absolute-query oracle

- Retain break-independent numeric blocks and compact placement-segment/visual-span state in production. CPU semantic and
  query output keeps its absolute coordinate surface, while renderer placement consumes the engine-owned slot and
  root-scoped f32x2 row derived from the same local-plus-placement authority.
- Populate that state from the single existing positioning traversal. Do not add a parallel placement walk or duplicate
  justification arithmetic; segment translation is exactly f64 inline/block and all role, bidi, block, and justification
  metadata remains outside the renderer row.
- Implement every existing word/character/no-wrap, dense CJK, bidi L1/L2, hanging-space, justification, decoration,
  ellipsis, measurement, hit-test, borrowed/full glyph-query, detached-slice, and custom-program behavior before cutover.
- Copy and rebind retained line segment/span topology transactionally by run canonical revision and stable segment anchor;
  if compact validation fails, use the same normal positioning traversal, not a second rematerializer.
- Keep every rendered glyph mapped to exactly one segment while outline-less semantic glyphs, glyphless clusters, hard
  breaks, and boundary replacement retain explicit source ownership without fabricating instances.
- Keep comparison arithmetic only as a test oracle for topology and measured numeric/pixel delta; do not ship two
  first-party width paths.
- Preserve shaping, local edits, font-size invalidation, ellipsis boundary shaping, commit/abort, and identity semantics.
  Prove a paint/material/raster/decorating-only update changes render/decor spans without changing `LayoutRun` or
  placement identity/revisions.

Exit: compact core state is total over the existing behavior matrix, CPU query output and renderer output agree under the
re-pinned operation order, and retained resolution is bounded and allocation-stable after warmup. A warmed width change
must reuse static glyph/raster/effect state before the final compact-publication checkpoint claims zero static writes.

### M3 — atomic indexed-placement ABI, query, and renderer cutover

- Add the hidden engine-owned u32 occurrence slot after portable raster Codec authoring and publish one root-scoped f32x2
  placement table; adapters own physical packing and no run/line/slot-allocation field enters the public Codec plan.
- Define numeric wire representation, change-mask semantics, capacities, range jobs, patches, acknowledgement, and
  retirement in the generated contract without changing batch or draw identity.
- Publish static glyph-local/numeric-block/run-slot records only on topology or local-geometry changes, never visual-slice
  boundary changes.
- Publish placement, visual-order, and decoration patches on width changes.
- Teach the generic realization boundary to resolve the occurrence slot and combine local glyph data with the selected
  x/y row.
- Migrate Bitmap, MTSDF, Slug, decoration, and custom program registration across `/three` and `/three/typegpu`.
- Migrate base `/typegpu` Bitmap/MTSDF/Slug in the same tip using adapter-owned storage or instance packing validated
  against the production callback and baseline-device contract. TypeGPU remains a proof-of-concept and does not dictate
  the shared Codec memory layout; it still has no decoration path.
- Migrate `snapshotGlyphOrigins`, Three `glyphPlacements`, bounds/raycast/caret/selection queries, generated validators,
  `material-realizer.ts`, and `registerThreeRasterProgram` in the same tip.
- Preserve custom material override semantics and package optional-dependency/tree-shaking boundaries.
- Regenerate every ABI surface, switch the entire core authority, and remove the old materializer from production in the
  same coherent commit. Compile it only into oracle tests. No intermediate pushed/reviewable tip may pair the new core
  contract with old renderers or vice versa; use preparatory dormant commits if needed, then one atomic enabling commit.

Exit: every first-party integration and custom-program boundary consumes the same core publication with existing draw
counts; CPU queries and renderers agree on the re-pinned coordinate bits; the complete non-coordinate behavior matrix and
declared numeric/pixel gates pass; warmed width changes with unchanged text, font/local geometry, and
boundary-replacement topology—including dense-CJK slice-boundary changes—write zero static glyph-local/numeric-block
bytes; commit/abort stays atomic; `benchmark:external-raster`, the `/three` and `/three/typegpu` live probes, and the
`/typegpu` hello-world pass from the packaged exports.

### M4 — retained flow geometry and public 2D authoring

- Give regions and exclusions stable identities/revisions and preserve the existing packed vertex authority.
- Remove the legacy Three `maxExclusions: 1` feature cap. Keep zero exclusion allocation for empty flows; on first use,
  reserve 16 entries in retained exclusion/binding `Vec` arenas, then grow geometrically. Grow lazy slot output/scratch
  independently. Retain explicit global entity, vertex, and slot ceilings only to reject hostile/unbounded transactions.
- Strengthen existing `FlowLayoutArena::rebuild_until_state_converges` with the first-affected band, future dirty horizon,
  and exact suffix certificate against cold rebuild.
- Expose experimental rectangle/polygon region and exclusion inputs through the shared config/controller boundary;
  validate finite bounds, global vertex/entity caps, distinct vertices, nonzero area, wrap side, margins, one simple ring,
  and no holes/self-intersection before Wasm. Preserve horizontal-edge, critical-block, and between-critical midpoint
  sampling regressions for exact concave regions and conservative concave exclusions.
- Prove simultaneous drop-cap and object exclusions, sequential regions, multiple slots, and LTR/RTL/mixed reading
  order without adding branches to ordinary rectangular flow.

Exit: public 2D polygon flow uses the existing Rust authority; moving one obstacle touches only affected bands and run
placements; unchanged rectangular columns remain flat; exact cold-oracle parity holds.

Current checkpoint: public 2D authoring, stable keyed IDs, per-entity revision retention, pre-Wasm simple-ring/f32
validation, React/Three threading, removal of the one-exclusion cap, and the first-use 16-entry retained exclusion reserve
are implemented. A public integration fixture composes one polygon region around two simultaneous exclusions into three
same-line slots, while low-level transaction evidence proves that moving one exclusion advances only its revision and
that array reordering preserves entity IDs/revisions. Retained exact-width, non-ellipsis flow also unions the old/new
bounds and margins of multiple changed exclusions in one region, preserves the prefix, recomposes through the complete
dirty horizon, and retains a suffix only after the exact line/fragment/slot certificate matches; unsupported cases fall
back to the cold authority. A public justified LTR/RTL/mixed matrix moves two keyed exclusions across distinct block
bands and matches a cold rebuild across every glyph, bidi, ink, line, and measurement column while retaining the edited
paragraph's glyph identities. Together with the existing sequential-region and drop-cap/object fixtures, this closes the
M4 cold-oracle matrix.

### M5 — projected 3D obstacles and same-source drop caps

- Add the renderer-neutral canonical 2D exclusion model and a Three-specific projection helper for known bounds or a
  simplified CPU-visible silhouette. Do not introduce Three/camera types into core.
- Add camera-side text-plane and frustum clipping, perspective/orthographic ray-plane mapping, conservative hull/inflate,
  flow clipping, and quantized no-op detection without GPU readback.
- Add the same-source EGC-plus-shaping-safe drop-cap entity, exact source/cluster mapping, body resume, anchor placement,
  cap-height/alignment, query merging, and mixed-raster realization.
- Upgrade the Editorial workload to stylized justified columns with a Slug drop cap and a moving 3D object that crosses
  the text plane, creates changing slots, exits, and restores the original layout.
- Attribute projection, slot resolution, reflow, placement, publication, and renderer submit independently.

Exit: perspective and orthographic projection cases are finite/conservative; the workload shows no overlap,
duplication, missing clusters, broad reshaping, or adapter-owned layout; both Three renderer paths agree.

Current checkpoint: Three now projects caller-known conservative object-local bounds or ordered simplified silhouettes
through the camera-side text-plane and frustum half-spaces into the existing keyed 2D exclusion model. A zero-inflation
silhouette preserves its validated simple concavity; conservative inflation intentionally produces a hull.
Perspective/orthographic, crossing, enclosing, behind-plane, clipping, quantization, malformed-ring, and
invalid-transform cases have focused package evidence. Editorial now owns two justified regions, a shaping-safe
three-line drop cap with a normalized simple contour, and a rotating box
projected independently into both columns. Focused Chromium evidence covers all six Bitmap/MTSDF/Slug × WebGPU/WebGL2
cells through native TSL and the experimental Three/TypeGPU shader path; every cell retains three draws through 64
projected-obstacle reflows. The same-source drop-cap slice now carries
bounded line/alignment/side/margin controls through the generated ABI; selects the first complete grapheme through a
HarfRust-safe boundary; resumes body composition at that exact cluster; derives its conservative cut from retained
glyph/design bounds or the authored contour; and positions the prefix through the existing body authority. Focused Rust
evidence covers safe-edge refusal, RTL logical-side mapping, a simultaneous rectangle exclusion, and tapered contour cuts,
while an attached Three integration proves a combining-mark cap has no duplicated/omitted source glyphs and shares the
existing x/y renderer path. The refreshed live matrix passes Bitmap/MTSDF/Slug on WebGPU/WebGL2 through native TSL and
the experimental Three/TypeGPU shaders while retaining three draws across every 64-sample reflow sequence. The public
Three path now realizes a Slug cap beside a Bitmap
body as two retained raster batches, preserves that topology across a cap-source edit, and matches a simultaneously
rendered cold paragraph for glyph measurements, cap/body caret hits, and selection rectangles after exclusion movement.
Explicit multi-line flow now composes the cap beside another exclusion through the public Three
surface; moving that exclusion reuses dirty-band convergence, rederives and baseline-aligns the cap, and matches a cold
rebuild before accepting retained suffix lines. Same-length edits inside the cap source now use the retained text-edit
convergence path: they rederive the cap, recompose every band still affected by the old or new cut, and retain a suffix
only after the source cursor and line metrics converge to the cold authority.

### M6 — full-matrix closure and oracle retirement

- Run the full existing and new flow/drop-cap/projection matrix across core and adapters; no typography or query behavior
  is deferred until this milestone.
- Delete the test oracle only after the full parity matrix and renderer migration are accepted; no legacy production
  domain remains.

Exit: the correctness matrix below passes without adapter-specific exceptions.

### M7 — profile, then consider SIMD

Start with branch-free scalar placement and comparison. Wasm SIMD128 carries two i64 or f64 positions per register;
process four or eight runs only by unrolling across two or four independent v128 accumulators. Add that kernel only if
profiling shows the candidate placement/dirty phase is at least 15% of end-to-end width-update time. Admit SIMD only
when it:

- is at least 1.20x faster than the scalar kernel in three interleaved rounds;
- improves full width-update median by at least 5%;
- does not worsen end-to-end p95;
- is bit-exact with scalar wide-fixed-point fit/distribution output and the f64/f32 positioning contract; and
- remains inside package-size gates.

Otherwise keep scalar. Do not change the proven word-fit SIMD/chunk kernels merely to share naming or abstraction.

### M8 — release validation and stack handoff

- Run focused, package, repository, docs, package-boundary, and browser gates.
- Update durable package/decision docs and delete this disposable plan when the work lands.
- Before implementation, fetch remote `main`, record the exact post-merge commit/tree, and branch from that updated
  `origin/main`. This work is a fresh frontier, not another layer of the merged recovery stack; confirm its GitHub base
  is `main` before pushing.
- Push and hold unmerged for the maintainer's remote benchmark pass.

## Correctness gates

The shadow oracle and final implementation cover:

- LTR/RTL/mixed bidi, isolate and override controls, combining marks, overlapping glyphs, and ligatures, including at
  least two disjoint slots where the second fragment is checked against an independent UAX #9 oracle;
- Latin, Arabic, CJK, emoji sequences, and character fallback at HarfRust-safe cluster boundaries, with homogeneous
  dense CJK retained as large topology runs and mapped exactly through line slices;
- word, character, and no-wrap policies; every alignment and writing/flow mode already supported;
- paint/material/raster/decorating-only changes that preserve run/slice/placement identity while updating render spans;
- word/inter-character justification, deterministic wide-fixed-point remainder distribution, and non-justified final lines;
- leading/trailing/hanging spaces, hard breaks, empty lines, ellipsis, and boundary replacement;
- custom `registerThreeRasterProgram` programs using the same run-placement contract as built-ins;
- continuous and discontinuous under/content/over decorations;
- measure-before-render, measure-after-render, width no-op, hit testing, `withGlyphs`, full glyph copies, and detached
  slices;
- generic read-only `withGlyphs` callbacks and distinct transform-returning `transformGlyphs` callbacks; exact 1:1
  length validation; local, paragraph, and world-space per-glyph deformation; physics-frame dirty-range updates without
  reshaping or draw churn; topology-change rebinding;
  atomic rejection; and detached-copy lifecycle independence;
- commit, abort, retry, removal, independent exclusion/slot capacity growth, publication acknowledgement, vertex/range
  retirement, generation reuse, stale-handle rejection, and `ResultTooLarge` rollback;
- rectangle and valid simple convex/concave polygon regions; invalid/self-intersecting/zero-area rings; horizontal edges;
  diamond and conservatively hulled concave exclusions; margins and every wrap side; simultaneous cap/object exclusions;
  sequential regions; and multiple slots per band;
- moving 2D and projected 3D obstacles across perspective/orthographic cameras, near/frustum/text-plane crossings,
  objects behind the camera and behind the text plane, a camera on/parallel to the plane, rotated/scaled/degenerate text
  transforms, topology changes, and unchanged quantized projections;
- same-source drop caps spanning one through five lines, complete EGC plus shaping-safe selection, combining marks,
  ligatures, fallback, local edits, LTR/RTL, mixed-raster cap/body, no duplicated or missing cluster, and stable source,
  caret, selection, hit-test, and inspection mapping; and
- justified LTR/RTL/mixed content in every produced slot with exact logical and visual reading order.

For each case compare exact line breaks, run/slice/glyph source ranges, visual-order permutation, wide-fixed-point fit and
distribution decisions, exact agreement between CPU semantic/query and renderer coordinates under the re-pinned
operations, signed/absolute/ULP deltas from the old numeric oracle, ink and logical bounds, content/geometry revisions,
decoration records, render-plan primitives/draws/patches, and pixel output.
Randomized state transitions use fixed seeds and compare against the retained baseline oracle; regenerated goldens are
not an acceptance mechanism.

## Performance and memory gates

### Rust and publication

Run the pinned `glyph:rust-layout-benchmark` at 22k glyphs with `column-resize`, 40 warmups, 101 repetitions, and raw
samples for Bitmap, MTSDF, and Slug. Interleave baseline/candidate order over at least three rounds on the same machine.
Also run measurement query, cold layout, font-size changes, localized edits/splices, equivalent-width no-ops, mixed bidi,
dense CJK character wrap, justification, polygon exclusions, a moving obstacle, and the stylized drop-cap Editorial
scene. Attribute projection, slot resolution, composition, positioning, publication, and renderer submit separately.

Merge targets:

- on the designated reference machine, complete ordinary Latin width update is at most `1.0 ms` median and `2.0 ms` p95;
- on every machine, the candidate is also at least 30% faster at p95 than an identically built, interleaved frozen-main
  baseline. A non-reference machine may establish the relative result but cannot waive the absolute reference-machine
  gate; no target is waived without a fresh attributed report;
- zero broad shaping calls and zero static glyph-local/numeric-block publication bytes for a warmed width change with
  unchanged text, font/local geometry, and boundary-replacement topology;
- ordinary changed-width placement publication at most 25% of each exact per-technique baseline: 8 bytes/glyph for
  Bitmap and 16 bytes/glyph for MTSDF/Slug before fixed metadata;
- in the homogeneous 22k CJK character-wrap fixture, retained `LayoutRun` count equals topology-run count rather than
  legal-break/cluster/glyph count; slice count is bounded by produced `FlowFragment` count plus explicit hanging or
  boundary-replacement slices; slice ranges cover every renderable glyph exactly once with no overlap or gap;
- dense-CJK width updates with unchanged text, font/local geometry, and boundary-replacement topology publish zero static
  glyph-local/numeric-block bytes and no per-cluster placement row; dynamic occurrence/placement/order bytes, total
  retained high-water bytes, and actual GPU transfer may be larger than the Latin 25% target but must not exceed the
  corresponding absolute-origin baseline or regress median/p95 beyond the 3% gate;
- measurement query satisfies both bars: no worse than 3% versus its freshly reproduced same-machine baseline and no
  higher than `0.35 ms` median / `0.45 ms` p95 on the designated reference machine;
- no workload median or p95 regression above 3%; dense CJK and mixed bidi may use a 3% noise band but no directional
  regression across all three rounds;
- zero steady-state allocation after high-water warmup;
- geometry edits reshape zero unaffected source runs and converge to the retained suffix when the exact certificate
  permits it; and
- unchanged ordinary rectangles/columns remain within the 3% noise band and write no polygon sideband.

Record active/reserved run and slice counts, placement/order/decor bytes, static glyph bytes, Wasm retained bytes, CPU
staging, GPU static and dynamic capacity, per-update publication, and patch count separately. Initial budgets: no
static-glyph growth above 4 bytes/glyph for the run slot; core placement at most 16 bytes/active slice, with the required
GPU row at 8 bytes; and no pool or total high-water increase above 3% without an identified, measured tradeoff accepted
before merge.

### GPU and adapters

The extra indexed placement read is not free. Run identical scenes for every raster technique through Three TSL,
`/three/typegpu`, and `/typegpu`, including WebGPU and Three's WebGL fallback where supported. The candidate must:

- keep GPU median and p95 within 3% of baseline and never regress either by more than `0.10 ms`;
- for the ordinary 22k Latin width update on WebGL2, transfer at most 25% of the baseline's actual padded/full-texture
  bytes after including backend row alignment; for dense CJK, transfer no more than the corresponding baseline;
- preserve existing draw counts and resource sharing, including mixed justified/ragged content sharing one resource;
- produce exact render-plan/order fixtures and accepted ordinary/justified pixel tolerances; and
- pass `benchmark:external-raster` with the new placement contract and preserve custom material augmentation; and
- prove default `/three` does not load TypeGPU while the TypeGPU subpaths remain functional and tree-shakeable.

### Browser and soak

Use `probe:live-update-latency` for maintained live-style/active-resize coverage plus
`benchmark:paragraph-stress-timing`, `benchmark:presentation-fresh-scene-performance`, `benchmark:presentation`, and
`benchmark:icon-grid-soak`. Run one browser instance at a time. Required results:

- Active Resize complete CPU update below `4 ms` p95, with core Rust-plus-plan work below `2 ms` p95;
- flat-or-better median and p95 against an identically built post-merge `main` for every workload;
- no disappeared graphs, maximum-depth errors, stale timer-query reads, or unrecovered frame stalls;
- zero unexplained frames above `50 ms` and zero above `100 ms` in a multi-minute Editorial/Icon Grid soak;
- the Editorial scene's moving 3D object crosses the text plane and exits while justified body text reflows around its
  projected polygon and stylized drop cap, then returns exactly to the initial layout; and
- bounded pending GPU timer queries and flat Wasm/JS/GPU memory after high-water warmup.

Live gates remain outside coverage accounting. Deterministic unit/integration tests own correctness; browser probes own
packaging, adapter, GPU, and real-timing evidence.

## Rejection conditions

Do not land the design if any of these remain true:

- changed-width publication still rewrites absolute origin for most glyphs;
- Three and TypeGPU need separate run/layout implementations;
- ordinary shaders branch per glyph on wrap, bidi, raster technique, or justification;
- bidi/order correctness requires one draw per run or slice, or otherwise increases the existing draw count;
- `withGlyphs` copies a full paragraph to answer a bounded callback;
- width changes allocate after warmup;
- the additional GPU offset path misses its adapter gate; or
- SIMD wins an isolated loop but worsens end-to-end median, p95, code size, or local reasoning.

The intended win is less topology-dependent work and less publication, not a more complicated way to move every glyph.
