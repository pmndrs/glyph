---
type: Design Proposal
title: Rust layout engine and the atomic frame ABI
description: Moves retained paragraph layout into the existing Rust shaper crate behind one frame-scoped entry point, so the logic that must be correct is written once and reused natively, and instance data reaches the GPU without leaving Wasm memory.
status: draft
tags:
  - layout
  - wasm
  - performance
  - abi
generated:
  by: anthropic-claude/opus-5
  at: '2026-08-08T05:10:00Z'
sources:
  - id: layout-benchmark
    resource: ../../packages/text/scripts/benchmark-paragraph-layout.mts
    title: Paragraph layout benchmark, workflow text:layout-benchmark
  - id: shaper-crate
    resource: ../../packages/text/rust/shaper/src/lib.rs
    title: HarfRust Wasm shaper crate
  - id: paragraph
    resource: ../../packages/text/src/paragraph.ts
    title: TypeScript paragraph preparation and layout
  - id: bitmap
    resource: ../../packages/text/src/raster/bitmap-technique.ts
    title: Portable Bitmap technique, canonical instance storage
  - id: pbo
    resource: https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl-fallback/nodes/GLSLNodeBuilder.js
    title: Three.js WebGL fallback node builder, setupPBO
  - id: pretext
    resource: https://github.com/chenglou/pretext
    title: Pretext, incremental per-line text layout
---

# Rust layout engine and the atomic frame ABI

This proposal moves retained paragraph layout from TypeScript into the existing Rust shaper crate, behind a single
frame-scoped entry point, and makes canonical instance storage the engine's output rather than something JavaScript
assembles afterwards.

It is written after a measured TypeScript optimization pass, so it inherits that pass's evidence rather than
speculating. Read [the decision register](decision-register.md) entries D-159 and D-160 for the tiering and the
measurement discipline the numbers below depend on.

## Why this is not only a performance change

Three requirements decide the shape, and only one of them is speed.

**The logic must be written once.** Bidi resolution, cluster boundaries, break opportunities, shaping integration, and
line composition are the parts most expensive to get right and most expensive to get wrong. A native consumer that
reimplements them inherits a second set of bugs and a second conformance obligation. Rust compiles to both targets from
one source, so the correctness-critical core stops being a per-target liability.

**Layout must be per line, with a caller-supplied width.** An editorial page flows text around images and objects, so
each line has its own available width, computed by subtracting blocked intervals. A paragraph-scoped pass cannot express
that: there is no single width to pass it. Pretext demonstrates the working shape — prepare once, then
`layoutNextLine(prepared, cursor, maxWidth)` with a segment/grapheme cursor carried between calls, each call free to
take a different width.[^pretext] Per-line layout is therefore a feature requirement that happens to also be the
performance answer.

**The frame must cross the boundary once.** Not once per operation — once. Today a text edit crosses three times
(`analyzeBidi`, `shapeBatch`, `reshapeRanges`) and a resize once. Three exports mean three opportunities for the host to
observe or mutate intermediate state, and they are the reason layout logic accreted on the JavaScript side: whatever
sits between two crossings has to live somewhere, and it lived in TypeScript.

## What per-line layout does and does not buy

Layout cascades. If a break position moves on line three, every line after it moves. Per-line composition does not
remove that and no model does; it is inherent to flow. What changes is the cost of each cascaded line and the number of
lines that must be composed at all.

| Property | Paragraph-scoped pass | Per-line with a cursor |
| --- | --- | --- |
| Cascade length after a break moves | lines after the change | lines after the change |
| Reshape cost per cascaded line | whole line | glyphs straddling the boundary |
| Per-line available width | one width for the paragraph | one width per line |
| Stop when the viewport is full | not expressible | stop at the last visible line |
| Resume after an edit | recompose the paragraph | resume from the last unaffected line |

The last two are the asymptotic ones. Four columns of six thousand glyphs with forty visible lines each compose forty
lines per column, not the whole column. That is the case the roadmap's editorial showcase actually renders, and a
paragraph-scoped pass cannot reach it by any constant-factor tuning.

## What the TypeScript pass already established

Do not re-derive these; they are measured and they bound what remains.

Cost per invalidation class at 25,515 glyphs, identical workload, pre-optimization commit against the current tree:

| Case | Before | After |
| --- | --- | --- |
| Resize | 103.54 ms | 21.54 ms |
| Reflow | 110.40 ms | 17.37 ms |
| Text edit | 109.66 ms | 39.53 ms |

Three findings from that pass constrain this design.

**Marshalling is not the cost.** Copying the shaped result out of Wasm across eleven arrays costs 0.08 ms per update for
604 KiB; copying canonical storage into the Three attribute costs 0.043 ms for 1.22 MB. Bulk copies are fast. Retaining
data in Wasm is worth doing because it decides *where the compute happens*, not because the copies are expensive. Any
proposal that justifies itself by saved memcpy time is justifying itself wrongly.

**Boundary reshaping was redundant as built.** It requested the whole run as shaping context, which is the context the
retained shape already used, so it returned the glyphs it already had. Measured byte-identical over 640 ranges and
20,280 glyphs across Latin word wrap, Arabic word wrap, and Arabic character wrap narrow enough to break inside joined
words. The capability matters only under a *narrowed* context, which is exactly what per-line composition and ellipsis
truncation introduce — so the Rust engine must reintroduce it deliberately, with a test that fails when it is absent.

**Segmentation and line breaking are already absent from the warm paths.** The text-analysis tier is retained across any
change that alters neither text nor base direction, so a resize and a reflow do not touch them. Moving them to Rust
cannot improve those two classes by any amount. They move for the write-once requirement, not for frame budget.

## The ABI

One export per frame.

```
text_update(request_offset: u32, request_len: u32) -> u32   // returns result offset
```

Bidi, shaping, segmentation, line composition, boundary reshaping, and instance packing all become internal Rust calls.
`analyzeBidi`, `shapeBatch`, and `reshapeRanges` stop existing at the boundary. There is no partial-state seam for
layout logic to accrete on.

**The request is written in place.** JavaScript holds a pinned view over a retained staging region and writes the
frame's mutations into it: text deltas, style and span changes, constraints, and the per-line width intervals that carry
hole punching. Then it calls `text_update` once.

**Growth never costs a second crossing in steady state.** The result header carries the capacity the next frame will
need. Growth happens at the top of the next single call. A frame that grows toward the watermark may need a second call;
growth doubles and then backs off to fit, so this settles and does not recur.

**Detachment has one discipline, because `memory.grow()` detaches every view regardless of a declared maximum**
— verified in the pinned Node runtime: with `maximum` set, `buffer.resizable` is `false` and an existing view is
detached by a grow. Double buffering inside Wasm does not prevent this; detachment is a property of the memory, not of
a buffer slot. The rule is therefore:

1. `text_update` is the only export that may grow memory.
2. After it returns, compare `memory.buffer` identity against the retained one.
3. Re-pin every view if it changed.
4. Upload. No Wasm call may occur between re-pin and upload.

Double buffering remains in the design for its actual purpose: the engine writes the next frame's instance data into the
free buffer while the active one is still being read by the renderer, and swaps. That is what makes the retained result
safe to alias, once the detachment discipline above holds.

**The result is instance data, not shaped glyphs.** The engine writes canonical technique storage directly — for Bitmap
that is `origins`, `sizes`, `uvOrigins`, `uvSizes` as tightly packed pairs and `colors` as quads, which is already the
GPU attribute layout[^bitmap] — plus the coalesced dirty ranges describing what changed.

## What the GPU can and cannot alias

Verified against the pinned Three.js, not assumed.

**WebGPU aliases correctly**, for `itemSize` 2 and 4. `itemSize` 3 makes Three reallocate every update. Bitmap's layout
qualifies as authored; MTSDF and Slug repack into `vec4` and need their canonical layouts checked against the same
constraint before they can alias.

**WebGL2 cannot alias under the PBO path.** `GLSLNodeBuilder.setupPBO` assigns `attribute.array = newArray` with
power-of-two padding and hands that array to a `DataTexture` it retains by reference.[^pbo] A view over Wasm memory is
copied once and dropped, and later re-pinning is silently ineffective.

This is not a blocker. One copy on WebGL2 replaces the four the current pipeline performs, and WebGPU — the flagship
backend and the native path — gets the direct alias. The design should not contort to make WebGL2 zero-copy.

## Staging

Each stage lands independently, proves byte-identical layout against the pinned goldens, and reports
`text:layout-benchmark` before and after. A stage that does not move its measured number is reported as such and kept or
dropped on its merits, not on expectation.

**Stage 1 — the atomic entry point, no logic moved.** Introduce `text_update` and the retained staging region. Bidi,
shaping, and reshaping become internal calls behind it; the three current exports are removed. Layout stays in
TypeScript, driven through the new single crossing. This isolates the ABI change from every logic change, so a
regression here is unambiguously the ABI.

**Stage 2 — instance packing in Rust.** Canonical storage becomes engine output. This is the phase with the most
favourable ratio: a fixed-width transform, no data dependence between glyphs, and it is where SIMD pays first. Gate on
the packed-consumer hash staying byte-identical.

**Stage 3 — per-line composition with a cursor.** `layout_next_line(cursor, max_width)` with the caller supplying width
per line. Line breaking initially consumes host-supplied break opportunities so the Unicode conformance gate is
untouched. Boundary reshaping returns here, under a narrowed context, with a test that fails if it is absent — this is
where hole punching and correct ellipsis truncation become expressible.

**Stage 4 — text analysis in Rust.** Grapheme segmentation moves first; `unicode-segmentation` is Unicode 17 and passes
the official grapheme vectors. Line breaking waits: no published Rust crate passes Unicode 17 `LineBreakTest`, and this
repository gates on that file passing unchanged. Until ICU4X publishes a conforming UAX #14 segmenter, break
opportunities stay host-supplied through the Stage 3 ABI, which costs nothing because the tier is already retained
across the warm paths.

## Where SIMD pays

Named so the claim can be checked rather than assumed. In descending expected value: instance packing, a fixed-width
transform over independent glyphs; cluster advance prefix sums; per-line width accumulation; break-candidate scanning
over packed flags; and bidi level run detection. Each should be measured against a scalar Rust baseline before it is
described as a win — a Rust rewrite that is not vectorized is the honest comparison point, not the TypeScript one.

## Risks

The engine that must not regress is 1,800 lines of subtle bidi, cluster, and line-composition logic behind goldens that
have already caught one real precision regression and one crash during this work. The staging exists so that each
landing has a small blast radius.

Two facts specifically limit the achievable win and should be restated whenever this plan is quoted: text analysis is
already absent from resize and reflow, and boundary reshaping as previously built was redundant. Both were removed in
TypeScript. The Rust engine inherits an already-tightened baseline, so its case rests on write-once correctness,
per-line composition, and vectorized packing — not on the original numbers.

[^pretext]: [Pretext](https://github.com/chenglou/pretext) exposes `layoutNextLine(prepared, cursor, maxWidth)` and a
    range-returning variant, carrying a segment/grapheme cursor between calls and keeping prepared segment widths valid
    across them.

[^bitmap]: `createStorage` returns `Float32Array(capacity * 2)` for origins, sizes, and both UV pairs, and
    `Float32Array(capacity * 4)` for colors.

[^pbo]: `setupPBO` replaces the attribute array with a padded copy and constructs the `DataTexture` over that copy.
