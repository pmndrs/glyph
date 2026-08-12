---
type: Engineering Research
title: Adaptive dirty-range uploads for retained text plans
description: Compares three-flatland's bucketed sprite uploads with the Rust text render-plan compiler and defines the evidence needed to tune partial versus full GPU updates.
status: draft
tags: [render-plan, gpu, wasm, rust, three, performance, dirty-ranges]
sources:
  - id: flatland-tracker
    resource: https://github.com/thejustinwalsh/three-flatland/blob/2935a89fcd9999e8a8b3d3b733f7f7302285cd60/packages/three-flatland/src/pipeline/BucketedDirtyTracker.ts
    title: three-flatland BucketedDirtyTracker
  - id: flatland-batch
    resource: https://github.com/thejustinwalsh/three-flatland/blob/2935a89fcd9999e8a8b3d3b733f7f7302285cd60/packages/three-flatland/src/pipeline/SpriteBatch.ts
    title: three-flatland SpriteBatch thresholds and buffer ownership
  - id: flatland-flush
    resource: https://github.com/thejustinwalsh/three-flatland/blob/2935a89fcd9999e8a8b3d3b733f7f7302285cd60/packages/three-flatland/src/ecs/systems/flushDirtyRangesSystem.ts
    title: three-flatland end-of-frame dirty-range flush
  - id: text-packing
    resource: ../../packages/text/rust/shaper/src/engine/plan_packing.rs
    title: Rust render-plan range coalescing and upload cost model
  - id: text-ordered-plan
    resource: ../../packages/text/rust/shaper/src/engine/ordered_plan.rs
    title: Rust ordered-direct changed-range planning
  - id: text-stable-plan
    resource: ../../packages/text/rust/shaper/src/engine/stable_plan.rs
    title: Rust stable-indirect physical and order-buffer planning
  - id: text-three-target
    resource: ../../packages/text/src/three/engine-plan-target.ts
    title: Three render-plan executor and update-range forwarding
  - id: three-webgpu
    resource: https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgpu/utils/WebGPUAttributeUtils.js
    title: Three r185 WebGPU attribute uploads
  - id: three-webgl-fallback
    resource: https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl-fallback/utils/WebGLAttributeUtils.js
    title: Three r185 WebGL fallback attribute uploads
  - id: three-webgl
    resource: https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLAttributes.js
    title: Three r185 legacy WebGL attribute uploads
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-09T14:10:06Z'
---

# Adaptive dirty-range uploads for retained text plans

## Conclusion

The Flatland technique applies, but its core decision already exists in the Rust text render-plan compiler. The text
engine should not add `BucketedDirtyTracker` to the Three command-buffer executor or move dirty-range policy back to
TypeScript. Rust already receives the complete mutation transaction, derives exact changed record ranges, coalesces
small gaps, bounds fragmentation, and promotes expensive partial updates to one full live-record range before publishing
`PATCH_WRITE` commands.[^text-packing]

The useful work is therefore narrower:

1. calibrate the existing Rust integer cost model against the installed Three WebGPU and WebGL backends;
2. make the cost decision per physical buffer, including the stable-indirect order buffer, rather than treating every
   program stream as if it had the same changed-range economics;
3. use a Flatland-style reusable tracker only for renderer-local matrix and presentation-origin edits, which never cross
   `text_update`; and
4. remove avoidable host allocations while forwarding already-coalesced Rust patches to Three.

No new policy-program opcode is required. The renderer declares integer capabilities; the renderer-neutral Rust plan
compiler owns the decision; the adapter translates the resulting byte ranges into the backend API.

## What Flatland actually does

Flatland accumulates unordered per-slot writes over a frame. Each physical buffer owns a `BucketedDirtyTracker` with two
fixed `Int32Array`s: one first-dirty slot and one last-dirty slot per bucket. A clean-to-dirty bucket transition increments
one counter; later writes in the same bucket only widen its local span. The 16,384-instance default batch uses 256-slot
buckets, so each tracker scans 64 bucket entries at flush.[^flatland-tracker][^flatland-batch]

At the single end-of-frame flush, each buffer chooses one of two Three update shapes:

- fewer than the threshold: one `addUpdateRange` for the first-to-last dirty span in each dirty bucket;
- threshold reached: clear all ranges and set `needsUpdate`, requesting one full-buffer update.

The thresholds are buffer-specific: five dirty buckets for 16-float matrices and three for the 16-float interleaved core
and custom effect buffers.[^flatland-batch] These are call-count cutovers, not percentage thresholds. At maximum bucket
occupancy they correspond to 1,280 matrix instances or 768 interleaved instances, but even one changed slot in each of
three far-apart buckets selects the interleaved full upload. The ECS flush reads dirtiness before clearing the trackers so
the shadow pipeline can reuse the same signal without rescanning sprite data.[^flatland-flush]

Because Flatland allocates each typed array at `maxSize`, its empty-range full path uploads capacity, not only the active
`mesh.count`. The text planner's explicit promoted range is materially different: it targets the live record span plus
required initialized alignment padding. Fixed buckets also upload clean slots between the first and last mutation inside
each bucket. Flatland's source describes the design as strictly dominating one global min/max range, but that is a design
claim contingent on correctly tuned thresholds; it is not true for every sparse distribution or low-occupancy batch.

The implementation has exact unit tests for empty, one-slot, same-bucket, multi-bucket, threshold, reset, non-aligned
capacity, and different-stride cases. Its source comments claim approximately 5 ns per `markDirty`, a sub-microsecond
64-bucket walk, and mobile-WebGPU tuning. Those numbers are not accompanied by a retained microbenchmark artifact in the
surveyed commit, so they are design annotations rather than transferable evidence. The introducing commit reports a
holistic M2 result of approximately 27,000 effect-enabled sprites at 60 FPS, but it also interleaved buffers and removed a
per-frame ECS pass; it does not isolate dirty bucketing.

The source's claim that full updates use `bufferData` is stale for Three r185 updates. Once a buffer exists, the surveyed
backends use full-span `bufferSubData` or `GPUQueue.writeBuffer`; allocation is a separate path. That does not invalidate
the range-versus-full decision, but it changes the mechanism attributed to the win.

## What the Rust text path already does

The text planner has more information than Flatland's mutation-time tracker. Ordered-direct storage scans stable IDs and
content revisions in physical order to produce exact contiguous record ranges. Stable-indirect storage sorts changed
physical slots, creates exact ranges, and separately writes changed 64-entry logical-order chunks. Both reuse retained
scratch vectors rather than allocating one tracker object per frame.[^text-ordered-plan][^text-stable-plan]

`coalesce_ranges` then applies four renderer-declared controls:[^text-packing]

| Capability             | First-party Three value | Effect                                                                                                                                  |
| ---------------------- | ----------------------: | --------------------------------------------------------------------------------------------------------------------------------------- |
| update alignment       |                 4 bytes | expands record ranges to legal backend alignment                                                                                        |
| accepted gap           |     max(128, 256) bytes | merges neighboring ranges when uploading the gap is cheaper than another call                                                           |
| fragmentation budget   |                8 ranges | collapses excess fragments to one first-to-last span                                                                                    |
| whole-buffer threshold |      7,500 basis points | selects `0..live_records` when modeled partial cost reaches 75% of live bytes; later alignment may include initialized capacity padding |

This is the Flatland policy generalized from fixed buckets into exact ranges and an explicit byte/call cost model. It is
also already in the correct ownership layer: the renderer supplies capabilities as static data, while Rust makes one
deterministic decision over the whole transaction and publishes only the selected patches.

The Three executor copies each patch payload into retained typed storage and forwards its scalar range with
`addUpdateRange`. In r185, WebGPU issues one `queue.writeBuffer` per range and performs no additional merge. WebGL fallback
issues one `bufferSubData` per range and performs no merge. Legacy `WebGLRenderer` sorts and merges adjacent or overlapping
ranges in place before `bufferSubData`.[^three-webgpu][^three-webgl-fallback][^three-webgl] Pre-coalescing in Rust therefore
matters most for WebGPU and TSL's WebGL fallback; relying on legacy WebGL's merge would not cover the shipped renderer.

## Gaps in the current model

### Costing is program-wide before buffer liveness is known

The current coalescer computes `bytes_per_record` by summing every stream in the program, then selects one common range
shape. Semantic dependency masks are applied later, and each active physical buffer receives its own patch. This keeps
correct ranges and prevents inactive-buffer uploads, but the cost estimate can be wrong in both directions:

- a position-only update may touch one narrow stream, so aggregate stride makes clean gaps look more expensive than they
  are and can preserve too many calls;
- an update touching several streams pays one backend call per stream per range, while the model charges the range-call
  penalty only once.

Range selection should be evaluated per active physical buffer, or by an exactly equivalent active-buffer-weighted
model. This belongs in the Rust plan compiler after dependency liveness is known, not in policy bytecode and not in the
Three executor.

### Stable order chunks bypass the adaptive decision

Stable-indirect physical records use `coalesce_ranges`, but changed 64-entry order chunks currently become individual
patches. Sparse insertions benefit from that precision; broad edits can publish many order-buffer calls. The same
gap/call/full-live model should consume the changed order chunks before serialization, while preserving chunk retirement
and fence invariants.

### Renderer-local writes need their own tracker

Scene-transform synchronization and presentation-origin overrides intentionally do not call Wasm. They currently append
Three update ranges directly. Rust cannot coalesce changes it never sees. A small retained tracker in the Three adapter is
appropriate for these sidecars:

- one tracker for the shared 16-float transform matrix buffer;
- one tracker per origin buffer touched by presentation overrides;
- reset exactly once after all renderer-local writes for the frame;
- backend-calibrated range/full cutover, with no glyph-layout or policy semantics.

This is where Flatland's power-of-two buckets are directly reusable. It must not observe or reinterpret Rust
`PATCH_WRITE` commands.

### Host range forwarding still allocates

The executor constructs a new `Set` for touched buffer IDs on every plan and Three's `addUpdateRange` constructs one
`{start, count}` object per patch. Rust's fragmentation budget bounds this work but does not eliminate it. A retained
generation stamp can replace the per-apply `Set`; if Three's public contract permits it for the pinned version, retained
range objects can be mutated and the array length adjusted instead of appended. This is an allocation/GC hypothesis until
a Safari allocation trace and an end-to-end timing isolate it.

### WebGL storage-buffer emulation is a distinct upload shape

TSL's WebGL fallback represents storage attributes through a PBO-like `DataTexture` path. The builder can replace the
attribute array with power-of-two-padded storage, and the current executor only marks the retained PBO texture
`needsUpdate`; it does not forward the Rust ranges to texture update ranges. Consequently, attribute range reduction does
not by itself prove reduced WebGL texture traffic. WebGL fallback needs its own captured evidence and may require a
row-aware adapter translation or a deliberately conservative capability set. This backend detail must not change the
renderer-neutral patch ABI.

## Proposed ownership

| Concern                                                 | Owner                              | Reason                                                         |
| ------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| semantic dependency and changed glyph records           | Rust retained engine               | only this layer knows what changed and why                     |
| exact range, gap, fragmentation, and full-live decision | Rust render-plan compiler          | one deterministic decision before publication                  |
| cost constants and backend limits                       | registered renderer capability set | renderer knowledge expressed as validated data, not a callback |
| packing math                                            | policy program executed by Rust    | existing straight-line data transformation boundary            |
| byte-range to Three update-range translation            | Three executor                     | backend object and scalar-width knowledge                      |
| scene matrices and presentation-origin dirty tracking   | Three executor                     | renderer-local data never seen by `text_update`                |
| final GPU command submission                            | Three WebGPU/WebGL backend         | outside the renderer-neutral plan                              |

Adding bucket size or a fixed dirty-bucket count to the public policy now would overfit Flatland. The existing byte-cost
fields can express the decision more generally. A new capability field is justified only if the benchmark matrix shows
that exact ranges plus byte/call costing cannot reproduce a stable backend optimum.

## Correctness invariants

Any refinement must preserve these exact properties:

1. Applying patches in order produces byte-identical retained buffers to applying one full canonical replacement.
2. No emitted range crosses its buffer generation or allocated byte length, and every range satisfies scalar/backend
   alignment. Any aligned records beyond the live draw count retain initialized committed bytes.
3. Coalesced gaps contain committed bytes copied into the outgoing payload; clean bytes are never zeroed or left
   uninitialized merely because a larger upload was selected.
4. A replacement allocation is fully initialized even when semantic dependency masks would omit unchanged fields.
5. A no-op frame emits no patch, changes no Three attribute version, and performs no GPU upload.
6. Every active buffer's update ranges are cleared exactly once before its first update and remain available until Three
   consumes them.
7. An empty Three range list is legal only when the intended upload covers the entire allocated typed array; a promoted
   live span otherwise remains explicit, including any required initialized alignment padding.
8. Stable-indirect order-buffer coalescing preserves logical order, chunk retirement, and fence-delayed slot reuse.
9. Renderer-local trackers never alter Rust buffer identity, command ordering, draw boundaries, or semantic state.
10. WebGPU, WebGL fallback, and any native consumer may choose different cost constants but must realize identical final
    bytes and draws.

## Benchmark and admission matrix

The comparison must use the same 25,515-positioned-glyph workload and mutation definitions as the current layout evidence.
A smaller representative paragraph may be added, but it cannot replace the canonical worst case.

Test these update distributions for Bitmap, MTSDF, and Slug:

- no-op;
- one glyph, 32 adjacent glyphs, and one full 256-record bucket;
- 3, 5, and 9 far-apart single-glyph changes;
- every 64th and every 256th glyph;
- contiguous 1%, 5%, 10%, 25%, 50%, 75%, and 100% spans;
- width-only layout, font-size layout/resource selection, localized text edit, suffix edit, and paragraph reorder;
- stable-indirect insertion and broad order-buffer rewrite; and
- transform-only and presentation-origin-only renderer-local changes.

Compare at least these planners:

1. current exact-range cost model;
2. Flatland-equivalent 256-record buckets with 3/5-bucket cutovers;
3. exact per-buffer cost model with a sweep of range-call penalties and whole-live thresholds;
4. one min-to-max range; and
5. unconditional full-live upload.

Capture per update:

- `text_update`, range-planning, policy packing, publication, Three apply, render submit, and GPU time;
- patch count, update-range count, payload bytes, uploaded bytes, and full-live promotions per physical buffer;
- retained scratch high-water marks and warm allocations/GC;
- draw count and framebuffer/conformance hash; and
- p50, p95, maximum, and sample count on Chromium WebGPU, Safari WebGPU, and forced WebGL2 on the target computer.

The selection criterion is end-to-end frame cost, not minimum uploaded bytes in isolation. Adopt a threshold only when an
adjacent A/B run improves median without worsening p95, preserves every correctness invariant, and repeats across the
three raster techniques. Backend-specific constants are acceptable; backend-specific render-plan semantics are not.

## Not yet verified

- Flatland's fixed thresholds have not been isolated against its full-upload control on this computer.
- The current text capability values have not been swept against actual `writeBuffer`, `bufferSubData`, or PBO texture
  costs.
- The stride-specific Rust coalescing primitive is implemented with focused gap, fragmentation, full-live, and overflow
  tests. Ordered-direct and stable-indirect physical storage now retain one reusable range vector per possible physical
  buffer, select ranges through exact semantic dependency masks, align for that buffer's stride, and cost it separately.
  Stable 64-entry order chunks now use the same cost model and preserve committed bytes inside widened gaps. Identical
  per-buffer range shapes regroup into one multi-buffer packing job; the ungrouped prototype repeated cold policy
  execution per stream and regressed Bitmap/MTSDF/Slug by roughly 1.2/2.2/2.4 ms before this correction. After grouping,
  one canonical run measures 15.208/15.940/16.114 ms cold and 3.946/4.370/5.284 ms resize, versus two detached
  `bbd87d3e` baselines of 15.061–15.867 ms cold and 4.101–5.027 ms resize across the three techniques. Standard resize
  remains one patch with unchanged bytes and cannot prove the sparse-update benefit; the distribution matrix and browser
  upload evidence remain open.
- Safari GC attributed to update-range objects has not been isolated from other known per-frame allocations.
- Partial WebGL fallback PBO texture upload has not been proven through Three r185.

[^flatland-tracker]: The tracker stores first/last dirty slots in fixed typed arrays and scans the complete bucket table only at flush.

[^flatland-batch]: The audited snapshot fixes the bucket size at 256 and thresholds at 5 for matrices and 3 for interleaved/custom streams.

[^flatland-flush]: `flushDirtyRangesSystem` is scheduled after batch writes and reads `isDirty` before flushing.

[^text-packing]: `coalesce_ranges` implements gap merging, fragmentation collapse, and a basis-point whole-live threshold in `no_std + alloc` Rust.

[^text-ordered-plan]: Ordered-direct compilation derives changes from retained stable identity and content revision in physical order.

[^text-stable-plan]: Stable-indirect compilation retains physical slots and a separate 64-entry chunked logical-order buffer.

[^three-webgpu]: Three r185 WebGPU emits one `GPUQueue.writeBuffer` call for each declared update range.

[^three-webgl-fallback]: Three r185 WebGL fallback emits one `bufferSubData` call for each declared attribute range.

[^three-webgl]: Three r185 legacy WebGL merges overlapping or adjacent ranges in place before upload.
