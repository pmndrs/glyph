---
type: Engineering Report
title: WebGPU bindless textures for Glyph raster paging
description: Research snapshot of optional resource-table placement, dependency gaps, and correctness and performance gates.
status: draft
tags: [webgpu, bindless, paging, cjk, typegpu, threejs]
sources:
  - resource: https://toji.dev/2026/10/06/webgpu-bindless.html
  - resource: https://github.com/gpuweb/gpuweb/blob/main/proposals/bindless.md
  - resource: https://github.com/pmndrs/glyph/tree/e3ec444a270656b36e0ef41e658fb70db6993676
  - resource: ../planning/raster-data-contract.md
generated:
  by: openai-codex/gpt-6
  at: '2026-10-09T05:58:58.463490+00:00'
---

# WebGPU bindless textures for Glyph raster paging

Research date: 2026-10-09  
Repository: `pmndrs/glyph` `main` at `e3ec444a270656b36e0ef41e658fb70db6993676`  
Dependency snapshot: Three `0.185.1`, TypeGPU `0.12.5`, `@types/three` `0.185.4`, `@webgpu/types` `0.1.71`

Tracked in [#268](https://github.com/pmndrs/glyph/issues/268). This is an archived research snapshot; recheck mutable upstream APIs before implementation.

## Conclusion

**Do not make bindless textures a prerequisite for CJK paging.** Build the portable Milestone 14 page loader, cache, generation, and eviction model first. Bindless is a promising **experimental physical-placement backend** for that same residency system: it can replace “select a page by changing a bind group or draw” with “select a resident texture by a shader-visible descriptor index.” It does not fetch, authenticate, decode, upload, budget, evict, retain, or recover pages.

The immediate production choice should be independently resident page textures plus cached bind groups and ordered grouping by physical resource. A bounded 2D-array cache is a useful optimization for homogeneous Bitmap/MTSDF page cohorts. A bindless path should remain a feature-detected experiment until the WebGPU API ships without unsafe flags and Three/TypeGPU expose the required surfaces.

This conclusion does not depend on, or alter, the earlier fragment-depth result. Bindless changes resource selection and batching; it does not improve Glyph's current coverage equations.

Evidence labels used below:

- **Observed** — directly present in the cited source or repository snapshot.
- **Inferred** — a design consequence of those observations, not a measurement.
- **Unverified** — needs an implementation, browser/device test, or maintainer decision.

## 1. Experimental capability versus a shipping WebGPU feature

### Current capability on 2026-10-09

**Observed.** The GPUWeb proposal is a draft created 2025-10-13. Its intended shipping features are `"sampling-resource-table"` (sampled textures and samplers) and a later `"heterogeneous-resource-table"`; it fixes the initial maximum table size at 65,536 entries. It adds `GPUDevice.createResourceTable`, `insert`/`update`/`remove`, `GPURenderPassDescriptor.resourceTable`, `GPUComputePassEncoder.setResourceTable`, `GPUPipelineLayoutDescriptor.usesResourceTable`, and WGSL `enable resource_table` plus `getResource<T>`/`hasResource<T>`. See the [GPUWeb bindless proposal](https://github.com/gpuweb/gpuweb/blob/main/proposals/bindless.md) (created 2025-10-13), especially “Adapter capabilities,” “Encoder state,” “Updates,” and “WGSL.”

**Observed.** Chrome's implementation is not that shipping surface yet:

- adapter/device feature: `chromium-experimental-sampling-resource-table`;
- WGSL enable: `chromium_experimental_resource_table`;
- sampled `GPUTextureView`s and `GPUSampler`s only; buffers and storage textures are rejected;
- current Blink IDL exposes `createResourceTable`, table `insert`/`update`/`remove`, render-pass `resourceTable`, and pipeline-layout `usesResourceTable` behind `WebGPUExperimentalResourceTable` ([device](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/modules/webgpu/gpu_device.idl), [table](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/modules/webgpu/gpu_resource_table.idl), [render pass](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/modules/webgpu/gpu_render_pass_descriptor.idl), and [pipeline layout](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/modules/webgpu/gpu_pipeline_layout_descriptor.idl));
- Chrome implemented the browser surface on 2026-07-24 at main position `#1667805` ([Chromium commit](https://chromium.googlesource.com/chromium/src/+/8b7fc0dc99d5c2af64ecd37943f9f9456da769b3)); the current IDL still runtime-gates it.

**Observed.** Brandon Jones reported on 2026-10-06 that testing is available only in Chrome on Windows, Linux, and Android, with macOS “coming soon,” and that it requires Chrome's **Unsafe WebGPU Support** flag and is for development only. The same post identifies the prefixed feature name and says heterogeneous tables are not implemented. See [“Experimenting with Bindless Textures in WebGPU”](https://toji.dev/2026/10/06/webgpu-bindless.html), sections “Bindless in practice” and “Bindless beyond textures.” Dawn's end-to-end suite is instantiated on D3D12, Metal, and Vulkan, but native Dawn backend coverage is not evidence that Chrome exposes the feature on the corresponding browser/OS combination ([`ResourceTableTests.cpp`](https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/tests/end2end/ResourceTableTests.cpp), `DAWN_INSTANTIATE_TEST`).

**Decision.** Glyph must not ask users to enable an unsafe flag. The experimental path is suitable for local research only. Firefox, Safari, macOS Chrome, and other Chromium distributions are **unverified** here; absence from the cited availability statement is not a claim that none can run a native or development build.

### Correct feature detection

For an experiment, test the adapter before requesting the device, request the exact prefixed feature, then confirm it on the device. Do not detect only `device.createResourceTable`, and do not request the future unprefixed name in today's Chrome.

```ts
const feature = 'chromium-experimental-sampling-resource-table' as GPUFeatureName;
const adapter = await navigator.gpu.requestAdapter();
const supported = adapter?.features.has(feature) === true;

// Fall back to paged bind groups or a bounded texture-array cache when false.
const device = supported
  ? await adapter!.requestDevice({ requiredFeatures: [feature] })
  : await adapter?.requestDevice();

const enabled = device?.features.has(feature) === true;
```

The casts are necessary in this checkout because pinned `@webgpu/types@0.1.71` has no `GPUResourceTable` or resource-table feature declarations (**Observed** by source search). An experiment would need local ambient experimental types; production typings should wait for the standardized API.

### Shader and table restrictions

**Observed.** Current Dawn validation accepts exactly one sampled texture view or sampler per slot. Texture views must have `TextureBinding` usage, one aspect, and no YCbCr; buffers and storage textures are rejected. Dawn records texture dimension, base sampled type (`f32`, `u32`, `i32`, or depth), and filterability in shader-visible metadata. This includes `texture_2d<u32>`, so an `r32uint` sampled view used by `textureLoad` is in scope. See [`ResourceTable.cpp`](https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/native/ResourceTable.cpp), `ValidateBindingResource` and `ResourceTableBase::ComputeTypeId` (current main, accessed 2026-10-09).

**Observed.** The shader call names a static type but takes an arbitrary `i32` or `u32` index. Out-of-range, empty, destroyed, invisible, or type-incompatible entries resolve through a default resource; `hasResource<T>` is the explicit validity test. The draft still has open TODOs for normative default resources and final compatibility rules, while Dawn already implements defaults and filterability checks. This proposal/implementation divergence is a reason not to freeze Glyph API around current spellings.

**Observed.** Resource indices are intended to be non-uniform. The proposal notes that some hardware may scalarize non-uniform descriptor indexing, with a cost. It does not impose a WGSL uniform-index rule on `getResource`. Separately, ordinary WGSL derivative rules still apply: `textureSample`, `textureSampleBias`, and `textureSampleCompare` must occur in uniform control flow, while `textureLoad` has no derivative-uniformity requirement. See the [WGSL Candidate Recommendation Draft dated 2026-09-21](https://www.w3.org/TR/WGSL/#uniformity-analysis).

For Glyph, Bitmap/MTSDF's page selector is flat per glyph primitive today, which is a good input shape, but adjacent fragments can still choose different descriptors at primitive boundaries. Slug uses `textureLoad`, avoiding implicit derivatives. The cost of divergent descriptor selection is **unverified** and belongs in the GPU benchmark matrix.

**Observed.** Only one resource table is current for a render pass; Chrome's current render path supplies it when beginning the pass. Bindful groups can coexist. This is well suited to one device/renderer-owned sampling table plus ordinary Glyph scene/buffer bind groups, not one table per font or draw.

## 2. Current Glyph state and the preserved paging plan

### Serialized identity is already correct

**Observed.** A dense Bitmap/MTSDF record stores a `u16` logical page at byte 16, and Slug stores one at byte 8; `0xffff` means permanently absent ([`raster-records.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/internal/raster-records.ts#L1), `ABSENT_GLYPH_PAGE`). The canonical contract explicitly says that any other page value is a logical page-directory index, never a texture-array layer, binding slot, draw, or residency guarantee ([`raster-data-contract.md`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/.agents/docs/planning/raster-data-contract.md#L100), “Shared conventions”). That invariant is exactly what bindless integration needs: descriptor indices must remain a per-device projection, never serialized glyph identity.

**Observed.** Registration already separates identities and lifetimes. `FontRegistry` allocates an opaque `FontHandle`; each `RegisteredRasterImpl` has its own `RasterHandle` and carries its owning font handle, and disposing the font invalidates its rasters with explicit stale-handle errors ([`loader.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/loader.ts#L312), font registration; [`loader.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/loader.ts#L1850), raster registration and `RegisteredRasterImpl`). Immutable raster variants share and lease one `RegisteredFont` backing ([`loaded-font.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/loaded-font.ts#L22), `ImmutableFontBacking` and `ImmutableFontVariant`). A descriptor slot therefore belongs below these stable font/raster/logical-page identities; it must not become another font handle or page identity.

### Runtime loading is eager today

**Observed.** Runtime `RasterResourceSource` currently permits only `{type:'bufferView'}` ([`raster.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/raster.ts#L28)). `decodeEmbeddedLosslessAtlasPage` rejects an external page with “lazy page residency is not available yet” ([`raster-atlas.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/internal/raster-atlas.ts#L17)), and `RegisteredRasterImpl.resource` is only a buffer-view read ([`loader.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/loader.ts#L1935)). Bitmap, MTSDF, and Slug decoders loop over all pages and retain their decoded bytes before publication ([`bitmap-decoder.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/raster/internal/bitmap-decoder.ts#L68), [`msdf-decoder.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/raster/internal/msdf-decoder.ts#L77), [`slug-decoder.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/raster/internal/slug-decoder.ts#L59)).

**Observed.** The target contract is already broader: the page directory and dense records remain in the companion artifact, while embedded or authenticated external KTX2 page sources can be fetched, decoded, uploaded, cached, and evicted independently ([`raster-data-contract.md`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/.agents/docs/planning/raster-data-contract.md#L114), “Texture resource”). This is planned behavior, not implemented behavior.

### Physical resources today

**Observed.** Bitmap combines every page of a strike into one `r8unorm` texture array, padding every layer to the strike's maximum width and height. Every glyph in that strike names the first page's resource key, while its record page becomes the array layer ([`bitmap.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/raster/bitmap.ts#L178), `compileFont` and `bitmapAtlas`). MTSDF does the same with one padded `rgba8unorm` array for the entire raster ([`msdf.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/raster/msdf.ts#L214), `compileFont` and `msdfAtlas`). Thus both currently equate the logical page with an eager array layer as an implementation choice.

**Observed.** Slug is already page-granular in the portable resource plan: `compileFont` retains one `page` group per logical page and `resource(glyph)` selects it. `slugPagePayload` contains an `rgba16float` curve texture plus `r32uint` header and reference textures ([`slug.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/raster/slug.ts#L253), `compileFont`, `slugPagePayload`, and `packSlugReferences`). The source reference grid is `u16`; the current runtime packs pairs into `r32uint`. Bindless does not require or remove that packing choice.

**Observed.** Three realizes Bitmap/MTSDF as `DataArrayTexture`s and Slug as three `DataTexture`s. Resources are shared by portable-payload object identity across sibling roots and reference-counted until the last lease ends ([`renderer-resources.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/three/internal/renderer-resources.ts#L78), `ThreeRendererResources`; [`material-realizer.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/three/internal/material-realizer.ts#L417), `#textureArray` and `#slugPage`). TypeGPU similarly uploads one 2D array for Bitmap/MTSDF and three 2D textures for Slug, but each resolved resource directly owns and destroys its textures ([`resources.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/typegpu/internal/resources.ts#L137), `texture`, `bitmapResource`, `msdfResource`, and `slugResource`). TypeGPU draws one prepared draw per core resource span ([`renderer.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/typegpu/internal/renderer.ts#L164)).

### Existing lifetime machinery should own page generations

**Observed.** The renderer-neutral engine already retains resources by numeric identity and generation, passes `previous` plus an `AbortSignal` into `resolve`, publishes only an accepted transaction, and disposes superseded leases after settlement ([`create-engine.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/internal/create-engine.ts#L31), `RetainedResource`, `CommandBindingEngine.project`, and `settle`; [`glyph.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/config/glyph.ts#L234), `ResolveContext`).

**Decision.** Extend that resource/generation domain down to logical pages. Do not build an unrelated bindless cache that races it. A page generation should be keyed by at least `(raster identity, logical page, selected variant/strike, device)`, own its CPU/GPU allocations and physical placement lease, and publish through the existing transactional update. Three's handle-owned `ThreeRendererResources` is the natural per-device sharing point; TypeGPU needs equivalent root/device-owned sharing rather than a cache per text.

### Canonical plan to preserve

**Observed.** Milestone 14 already requires external page length/hash validation, request deduplication, cancellation, atomic generation swaps, residency accounting, deterministic eviction, and batching that does not equate a logical page with a layer, binding slot, draw, or order ([`roadmap.md`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/.agents/docs/roadmap/roadmap.md#L905), “Milestone 14”). It also retains one complete CJK shaping core while delivering raster units independently. The family plan likewise requires a coverage-first/locale-aware unit directory, stable per-face glyph namespaces, separate density strikes, old-strike retention during replacement, and selective residency ([`language-and-strike-bundles.md`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/.agents/docs/planning/language-and-strike-bundles.md#L29)). Bindless should be evaluated inside this plan, not replace it.

## 3. What bindless solves—and what remains

### It can solve

**Inferred.** Once pages are independently resident, a sampling resource table can:

- let one Bitmap or MTSDF pipeline choose among differently sized 2D page textures per glyph without padding them into an array;
- remove page texture bind-group switches and, where visual ordering and other material state permit, merge page-separated draws;
- let a Slug draw choose a curve/header/reference texture triple per glyph instead of requiring one draw/material realization per Slug page;
- reduce bind-group creation/update pressure for mixed fonts, fallback, and color images when their shaders/pipelines are otherwise compatible;
- allocate texture memory only for resident pages instead of allocating a full array's layers up front.

It does **not** eliminate all Glyph bind groups: placement, transforms, glyph instance buffers, paint, and any logical-page-to-physical metadata remain ordinary bindings. It also does not merge different raster techniques, blend modes, depth/material state, or order-sensitive transparent runs into one draw.

### It cannot solve

The following remain the same work with arrays, paged bind groups, or bindless:

- page-directory and coverage design;
- network fetch, URI policy, byte length and fingerprint verification;
- request deduplication, cancellation, worker KTX2 decode/transcode, and upload scheduling;
- CPU decoded-byte and per-device GPU-byte budgets;
- admission, LRU/clock policy, eviction, re-fetch, and cache telemetry;
- distinguishing permanent absence (`0xffff`) from valid-but-not-resident, loading, failed, and ready pages;
- maintaining immutable glyph IDs and logical page indices;
- retaining shaping/layout while raster readiness changes;
- atomic Slug triple publication;
- stale request rejection, device loss, and resource reconstruction;
- deterministic tofu/omit behavior and missing-glyph diagnostics.

The proposal itself calls out that bindless weakens the driver's knowledge of the working set and therefore does not provide application cache policy. WebGPU remains resilient, but Glyph still must decide which allocations exist and which pages its accepted render publications may reference.

### Descriptor stability, generations, and in-flight work

**Observed.** Dawn refuses to overwrite a slot that may be used by the GPU. `remove` empties it and records the last submitted serial; reuse becomes legal only after completion. `insert` scans for a reusable slot and can fail when none exists ([`ResourceTable.cpp`](https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/native/ResourceTable.cpp), `APIUpdate`, `APIInsert`, `APIRemove`, and `Remove`). This protects descriptor memory from an in-flight overwrite.

**Critical inference.** It does not protect Glyph from an application-stale index used in a _future_ submission. If slot 19 changes from CJK page A to another same-typed page B, `getResource<texture_2d<f32>>(19)` cannot detect that an old glyph buffer meant A. The result is valid but wrong pixels, not a validation failure.

Therefore:

1. Keep logical page IDs in artifacts and compiled font records.
2. Treat a descriptor slot as a backend-private field of one exact page generation.
3. Stage new textures into new/free slots; for Slug, stage all three slots first.
4. Build the new accepted render publication with those slots (or an internal logical-page mapping generation).
5. Only after acceptance retire the old publication/page lease; call `remove`; permit reuse after both Glyph references and WebGPU in-flight use are gone.
6. Never update a live slot in place to mean another page.

This fits `CommandBindingEngine`'s existing generation/settlement behavior. The simplest first experiment can write physical slots into backend-prepared instance lanes while preserving the logical values in the source records. If long-lived GPU buffers need logical-to-physical indirection, use one ordinary, generation-scoped storage mapping buffer; that is a projection of the same residency state, not a second cache. Measure its extra load before adopting it.

### Missing pages, eviction, and layout retention

**Decision.** Raster state must not reshape or reflow. `RegisteredFontData` retains `shapingSfnt` separately from raster sources/resources ([`registered-font.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/internal/registered-font.ts#L43), `RegisteredFontData`), and the raster contract says attaching or switching a raster cannot change paragraph measurement. Keep the complete selected shaping core and dense/page directory metadata resident; make only raster page payloads and GPU textures sparse.

For a visible glyph:

- `page == 0xffff`: permanent lack of representation; report coverage failure and use the chosen fallback/tofu policy without requesting a page;
- valid page, loading: retain the previous usable page/strike generation if one exists; otherwise preserve glyph advances/placement and draw deterministic tofu or omit ink according to an explicit policy;
- fetch/decode failure: preserve layout, surface a page diagnostic, and use the same deterministic visual fallback;
- eviction: do not evict a page referenced by an accepted publication. Evict only after the publication lease is retired; under hard budget pressure, reject new admission or publish a deliberate tofu generation rather than leave stale descriptor indices.

Do not rely on the resource table's unspecified/default resource as tofu. Its purpose is safety, not Glyph's visual or diagnostic contract.

### Device loss

Descriptor indices and resource tables are device-local and disposable. On device loss, invalidate the entire physical-placement map, table, texture views, and page GPU leases. Retain or refetch authenticated page bytes according to the CPU cache policy, then construct new page generations on the replacement device. Never serialize or carry a descriptor index across devices. This is a renderer integration responsibility; it does not require a public engine/device API.

## 4. Technique feasibility

| Technique             | Current sampling                                                    | Bindless representation                                                                       | Feasibility and constraints                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bitmap grayscale      | `r8unorm` array, linear sample, per-instance flat layer             | one `texture_2d<f32>` slot per resident page; one shared filtering sampler can remain bindful | Direct fit. Pages may differ in dimensions. Keep strike identity and sampling policy outside the slot.                                                      |
| MTSDF                 | linear `rgba8unorm` array, `textureSample`, per-instance flat layer | one `texture_2d<f32>` slot per resident page; shared filtering sampler                        | Direct fit. Pixel range/effect scale remain ordinary per-raster constants. Sampling must remain in uniform control flow.                                    |
| Slug curves           | `rgba16float`, `textureLoad`                                        | one `texture_2d<f32>` slot per page                                                           | Direct fit; no sampler or derivative restriction.                                                                                                           |
| Slug headers          | `r32uint`, `textureLoad`                                            | one `texture_2d<u32>` slot per page                                                           | Supported by current Dawn sampled-table type metadata. Unfilterable integer access is fine with `textureLoad`.                                              |
| Slug references       | serialized `u16`, currently packed into `r32uint`, `textureLoad`    | one `texture_2d<u32>` slot for the current runtime representation                             | Direct fit. Resource tables do not justify changing the packing. If Glyph later exposes `r16uint`, that is a separate format/backend decision.              |
| Color emoji (planned) | separate `rgba8unorm` sRGB Bitmap resource                          | `texture_2d<f32>` slots, likely separate pipeline/paint semantics                             | Resource-table-compatible, but not automatically batch-compatible with grayscale text. Color space, blending, sizing, and emoji technique decisions remain. |

**Observed.** The Slug contract requires curves, headers, and references to become resident as one page generation ([`raster-data-contract.md`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/.agents/docs/planning/raster-data-contract.md#L307), “Slug page descriptor”). A resource table does not provide a multi-slot transaction. Stage three slots, then publish the new page generation/mapping atomically; retire all three together.

**Inferred.** One sampling table can hold the above formats because current Dawn tags every slot by requested shader type/dimension/filterability. Shaders still call the correct static `getResource<T>`. A type mismatch produces a default rather than reinterpretation, but same-type stale reuse remains Glyph's responsibility.

## 5. Strategy comparison

| Property                | Bounded 2D texture-array cache                                                                                                | Fixed paged bind groups / group by page                            | Sampling resource table                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Shipping portability    | Core WebGPU; Three/TypeGPU supported today; WebGL2 analogue exists                                                            | Core WebGPU; Three/TypeGPU/WebGL2 supported today                  | Experimental Chrome-only surface today                                                            |
| Page dimensions/formats | Every layer in one array must share dimensions and format; smaller pages waste padded memory                                  | Independent per page                                               | Independent per page; shader type/dimension must match                                            |
| Capacity                | `maxTextureArrayLayers`; WebGPU guarantees only 256. Allocate a fixed budget, not all possible pages                          | Texture/bind-group cache budget; draws split by selected resources | Table max currently 65,536 slots, but actual texture memory/cache budget still applies            |
| Sparse memory           | Sparse only within a preallocated layer budget; every allocated layer consumes full layer bytes                               | Yes                                                                | Yes                                                                                               |
| Descriptor/binding work | One array bind; update layers on residency                                                                                    | Cached bind groups; bind/draw grouping on resource changes         | One table per pass; insert/remove on residency; index per glyph                                   |
| Draw merging            | Good within one homogeneous array                                                                                             | Page changes generally split draws, constrained by visual order    | Can avoid page-only splits within one compatible pipeline                                         |
| Mixed fonts/fallback    | Coalesce only if fonts share page size/format/array ownership; otherwise multiple arrays                                      | Works, with more groups/draws                                      | Best selector flexibility, but technique/material/order still split                               |
| Color emoji             | Usually separate RGBA/sRGB array and pipeline                                                                                 | Separate resources/pipeline                                        | Same table can hold views, but semantic pipeline split likely remains                             |
| Slug                    | Three arrays would require equal dimensions per resource class and coordinated layer mapping; awkward for variable page grids | Natural and already close to current implementation                | Natural three-slot page mapping; best chance to remove page-only draws                            |
| Eviction safety         | App maps logical page to layer and guards layer reuse                                                                         | Resource lease/bind-group lifetime                                 | App maps generation to slot; WebGPU delays in-flight reuse but cannot detect future stale indices |
| Best use                | Homogeneous Bitmap/MTSDF cohorts with fixed page dimensions and a small resident working set                                  | Production baseline and fallback                                   | Later experimental/optional backend for very mixed or variable pages and page-heavy draw streams  |

### Workload-specific reading

- **Large CJK, one font/technique:** a fixed-size array cache may already remove page draw splits with excellent portability if authored pages are homogeneous. Bindless's main extra benefit is avoiding fixed layer allocation/padding and allowing variable page sizes. Measure before preferring it.
- **Mixed-font fallback:** bindless makes texture selection independent of font ownership, but Glyph still must preserve run/visual order and each font-local glyph namespace. It can reduce page-only grouping, not shaping or fallback work.
- **Color emoji:** bindless helps access many differently sized images, the motivating shape in Jones's demo. Glyph's separate color resource/pipeline remains necessary.
- **Different page sizes/formats:** bindless or paged bindings avoid array padding. Bindless can put heterogeneous sampled types in one table, but a shader/pipeline still statically requests `f32` versus `u32` and technique-specific logic.
- **Slug:** currently the clearest batching beneficiary because each page is already a separate three-texture resource and therefore a separate resource span/material realization. It is not necessarily the largest memory beneficiary; page-walk evidence must decide.

## 6. Three 0.185.1 and TypeGPU 0.12.5 gaps

The installed dependency sources under `/private/tmp/glyph-ascii-slug-demo/node_modules` were inspected because this checkout has no `node_modules`. These are exact version observations, not statements about future releases.

### Three 0.185.1 / TSL

**Observed gaps.** There are no `GPUResourceTable`, `getResource`, `hasResource`, `usesResourceTable`, or resource-table WGSL symbols in the installed Three source.

- `src/renderers/webgpu/utils/WebGPUConstants.js:328`, `GPUFeatureName`, does not list the prefixed feature.
- `src/renderers/webgpu/WebGPUBackend.js:225-246` requests only its enumerated feature list when it creates a device. A caller-provided enabled device avoids that request limitation but not the remaining gaps.
- `src/renderers/webgpu/descriptors/GPUPipelineLayoutDescriptor.js:6-35` has only `label` and `bindGroupLayouts`; no `usesResourceTable`.
- `src/renderers/webgpu/utils/WebGPUPipelineUtils.js:202-214` always creates that explicit layout.
- `src/renderers/webgpu/WebGPUBackend.js:435-486` and its other pass paths create render-pass descriptors without `resourceTable`.
- `src/renderers/webgpu/nodes/WGSLNodeBuilder.js` has no codegen for the experimental enable or `getResource<T>`/`hasResource<T>`.

The current Glyph TSL materials bind a `DataArrayTexture` for Bitmap/MTSDF and concrete Slug textures per material ([`material-realizer.ts`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/packages/glyph/src/three/internal/material-realizer.ts#L124), `#bitmap`, `#msdf`, `#slug`). Therefore bindless cannot be added only inside Glyph's shader nodes; the renderer must also request the feature, own/bind the table at pass creation, and mark pipeline layouts.

**Proposed upstream discussion, not an API assumption:**

1. Renderer/device-scoped optional resource-table ownership and feature reporting, without auto-requesting unsafe experimental features in production.
2. A WebGPU-only TSL node for typed `getResource`/`hasResource`, with a separate bindful WebGL2 specialization.
3. Pipeline-layout cache/key support for `usesResourceTable` and shader enable directives.
4. A render-pass hook for the renderer-owned table, including all main, array-camera, shadow, and utility pass paths.
5. Explicit texture/table lifetime and device-loss rebuilding semantics.

No dedicated Three bindless/resource-table issue was found in the read-only issue/PR search on 2026-10-09. Maintainer appetite and the eventual abstraction are **unverified**.

### TypeGPU 0.12.5

**Observed gaps.** TypeGPU is closer to raw WebGPU but still lacks all typed resource-table integration.

- `core/root/init.d.ts:37-42`, `InitOptions`, can pass device required features, and `initFromDevice` can wrap a caller-created device. The pinned `GPUFeatureName` typing still lacks the prefixed name.
- `wgslExtensions.js:1-14` recognizes only `f16`, clip distances, dual-source blending, subgroups, and primitive index. It cannot emit `enable chromium_experimental_resource_table`.
- `std/texture.d.ts` exposes standard texture builtins but no `getResource`/`hasResource`.
- `core/rawCodeSnippet/tgpuRawCodeSnippet.d.ts:16-55` injects a typed expression; it does not supply the missing module-level enable, resource-table type/lifetime, pipeline layout, or pass state.
- `core/pipeline/renderPipeline.js:383-425`, `resolveAndCreateShaderModule`, explicitly creates a layout containing only generated bind-group layouts; no `usesResourceTable`.
- `core/commandEncoder/renderPass.d.ts:25-32`, `TgpuRenderPassDescriptor`, omits `resourceTable`, and `renderPass.js:53-95`, `INTERNAL_beginRenderPass`, copies only known fields.
- `TgpuRenderCommands` has no table operation. A caller can hand Glyph a raw pass already begun with a table, but TypeGPU's generated shader and explicit pipeline layout would still be incompatible.

**Proposed upstream discussion, not an API assumption:**

1. A feature-gated `TgpuResourceTable` wrapper with typed texture/sampler insertion and raw unwrap.
2. Typed `getResource`/`hasResource` shader expressions and support for the experimental/shipping WGSL enable names during transition.
3. `usesResourceTable` propagation into explicit pipeline layouts and `resourceTable` in render-pass descriptors.
4. Pass adoption that records whether a table is available and validates pipelines before drawing.
5. Tests for non-uniform `texture_2d<f32>` sampling, `texture_2d<u32>` loads, empty/type-mismatched slots, remove/reuse after submissions, and device loss.

TypeGPU should expose mechanics, not Glyph-specific paging policy. Glyph's existing `defineTypeGpuConfig` resolver and engine resource leases should remain the owner of page generations. No dedicated TypeGPU bindless/resource-table issue was found in the read-only issue/PR search on 2026-10-09; this is an upstream proposal, not an existing commitment.

## 7. Benchmark and correctness plan

No speedup claim is justified yet. Benchmark the same page directory, decoded bytes, visibility sequence, cache budget, and accepted frame sequence across three physical-placement strategies: bounded array cache, paged bind groups, and resource table. Include current eager arrays only as a small-font reference, not as the scalable CJK competitor.

### Matrix

- Bitmap R8 and MTSDF RGBA8 at 256, 2,048, 8,192, and complete selected-glyph coverage tiers already specified by the canonical benchmark plan.
- Slug pages with the same visible glyph/page walk where source coverage permits.
- one CJK face, mixed locale-aware CJK/Latin fallback, mixed page sizes, multiple bitmap strikes, and a color-emoji stress fixture when that technique exists;
- cold first view, warm steady view, sequential document scroll, locality-heavy/Zipf page walk, adversarial over-budget walk, rapid text replacement/cancellation, strike swap, and device-loss rebuild;
- Chrome experimental bindless on at least D3D12 Windows, Vulkan Linux, and Vulkan Android configurations where the feature is exposed; portable strategies on the full supported browser matrix. Record exact browser, Dawn/backend, adapter, driver, OS, table size, limits, and flags.

### Metrics

**CPU and command recording**

- index load/validation; page lookup and request-dedup time;
- fetch/hash, decode/transcode, and upload phases separately;
- resource-table `insert`/`remove` time and failures, array layer assignment, or bind-group creation/cache hit rate;
- render-plan/page-span preparation, instance-buffer/mapping updates, command encoding, bind-group calls, draw calls, JS allocations, and main-thread p50/p95/p99;
- never fold network/decode time into a claimed bindless CPU win.

**GPU frame cost**

- timestamp-query GPU duration where available, plus end-to-end frame time without forced synchronization;
- cold upload frame, first drawable frame, warm steady p50/p95/p99, and page-boundary-heavy frames;
- page/descriptor divergence sensitivity and shader mapping-buffer cost;
- draw and pipeline counts, while preserving order and blending correctness.

**Memory and churn**

- transport bytes, retained encoded and decoded CPU bytes, texture bytes from exact formats/dimensions/mips, padded array waste, resource-table requested slots and metadata/descriptor overhead, peak replacement bytes, and total per-device residency;
- resident pages, admissions, evictions, delayed slot/layer reuse, re-fetches, cache hit rate, duplicate suppression, upload bytes, and time over budget;
- current WebGPU does not provide a universally exact physical-memory query, so distinguish calculated allocation bytes from driver-reported or unavailable physical residency.

**Hitches and correctness**

- time from newly visible page demand to accepted drawable generation, p50/p95/p99/max;
- number and duration of tofu/omitted-ink frames, with layout hashes unchanged;
- logical page order deliberately permuted away from layer/slot/draw order;
- `0xffff` versus nonresident-page behavior; stale request completion; cancel then re-request; same-typed slot reuse; table exhaustion; eviction with in-flight submissions; Slug partial-load failure; old-strike retention; fallback visual order; and device loss;
- GPU readback and browser visual references for all three techniques. Slug must never expose only one or two members of its triple.

Precommit correctness gates and analysis before timing. Report confidence intervals or paired distributions; do not report only averages. The existing large-coverage plan already lists page occupancy, first-use, page-walk, cache, upload, GPU memory, and batch reports ([`roadmap.md`](https://github.com/pmndrs/glyph/blob/e3ec444a270656b36e0ef41e658fb70db6993676/.agents/docs/roadmap/roadmap.md#L911)); this matrix adds placement-backend attribution rather than creating another benchmark system.

## 8. Ranked adoption plan

1. **Implement the portable paging contract and one residency system.** Add authenticated external page sources, page preparation/dedup/cancellation, exact page generations, CPU/GPU budgets, deterministic eviction, and shaping/layout-preserving missing states. Keep logical page indices immutable. Use paged bind groups/grouping as the first renderer path. No public engine API change is required.
2. **Add a bounded homogeneous array-cache policy for Bitmap/MTSDF.** Allocate a budgeted number of equal-size layers, map current logical page generations to layers, and reuse only after retirement. Do not recreate today's eager all-pages array. Keep fixed paged resources as the fallback for variable sizes/formats and Slug.
3. **Instrument the canonical page-walk suite.** Establish how much CPU bind/update time and how many page-only draws actually remain after caching and grouping. This is the evidence threshold for bindless work.
4. **Open upstream design discussions with TypeGPU and Three.** Ask for the minimal general mechanics listed above. Do not fork public Glyph APIs around Chrome's prefixed experiment.
5. **Prototype bindless first in the direct TypeGPU/raw-WebGPU lane.** Behind exact feature detection, reuse the same page cache/generations and compare only the physical-placement/batching layer. Start with Bitmap or MTSDF one-slot pages, then Slug's atomic triple. Keep all production fallbacks active.
6. **Consider shipping only after the unprefixed feature is broadly available and measured.** Admission requires browser/OS coverage, stable typings, renderer support, correctness under churn/device loss, and a material improvement in the predeclared CPU/GPU/memory metrics. Otherwise retain it as a lab experiment.

## 9. Issue recommendation

**Recommend a new, narrowly scoped research issue when maintainers are ready, linked to the Milestone 14 paging work and issue [#220, “Dynamic Texture Atlas”](https://github.com/pmndrs/glyph/issues/220). Do not turn #220 into the bindless implementation tracker.**

#220 was opened 2026-09-20 for Canvas2D dynamic raster techniques and compute-generated MSDF/Slug data; its follow-up discusses individually indexed/compressed glyph payloads. Those overlap page supply and cache policy, but bindless resource tables concern renderer-side physical selection and batching. Combining them would blur two independent decisions and encourage a second residency system.

Suggested future issue title: `research(webgpu): evaluate resource tables as a raster-page placement backend`.

Its acceptance boundary should be: consume the Milestone 14 residency interface unchanged; feature-detected experimental TypeGPU/raw-WebGPU prototype; no public engine API; array/bind-group baselines; the benchmark/correctness gates above; and an explicit close-without-adoption outcome. A short cross-link/comment on #220 can note shared residency requirements, this report originally requested findings before an issue; the maintainer subsequently authorized the deferred feature tracker.

## 10. Explicit unknowns

- Final GPUWeb names, default-resource semantics, filterability compatibility rules, and heterogeneous-table scope are still draft.
- Chrome availability outside the 2026-10-06 Windows/Linux/Android statement was not tested; no unsafe flag was enabled.
- No live browser, device, server, benchmark, or shader compilation was run for this research.
- Three and TypeGPU maintainer interest, API shape, and delivery versions are unknown.
- Bindless CPU/GPU wins for Glyph are hypotheses. Page batching may already be dominated by paint/order/pipeline splits, and resource-table metadata/non-uniform access may offset saved bind work.
- Exact CJK page working sets, page-size distribution, and eviction behavior remain to be measured by the planned coverage tiers.

These unknowns do not block the portable paging work and are the reason bindless should remain an optional backend experiment.
