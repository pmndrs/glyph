# Scope lanes

Status: rescoping worksheet  
Purpose: decide what to build now without hard-coding away later capabilities.

The original discussion describes an eventual text platform, not a credible first implementation. This document separates four kinds of work:

1. **Build now**: required to prove the product's central contract.
2. **Reserve the lane**: V1 format/API must leave room, but implementation is deferred.
3. **Research later**: valuable only after baselines exist.
4. **Out of scope**: not a product commitment.

“Reserve the lane” does not mean adding placeholder machinery. It means choosing identities, versioning, ownership boundaries, and optional-section behavior that do not require a breaking redesign later.

## Proposed first build: one-font runtime vertical slice

The smallest coherent first build should answer one end-to-end question:

> Can `pmndrs/text` register one ordinary OpenType font in HarfRust Wasm, shape and reflow one paragraph, and render one pre-generated presentation without introducing identities or APIs that break when a second font is registered?

### Build now

- one pinned OpenType font and one pre-generated bitmap presentation fixture;
- runtime source-font registration and cached HarfRust state;
- source-local glyph IDs scoped by opaque font handles;
- experimental asset envelope and narrow validator/reader;
- HarfRust Wasm reference shaper;
- one coarse batched request/output ABI;
- UTF-16 cluster mapping and full scalar decoding;
- glyph IDs, clusters, four positioning values, and flags;
- HarfBuzz/HarfRust/GLB three-way conformance harness;
- JavaScript paragraph model, broad shaping, measured clusters, and greedy fixed-width reflow;
- font tables/slots in shaped and layout output even though the first paragraph uses one font;
- one explicit bitmap presentation plugin and direct bulk GPU upload;
- WebGPU/WebGL2 visual fixtures;
- Wasm size, registration, shaping, layout, upload, memory, and GPU baselines.

### Do not build in the first vertical slice

- font compiler or generalized baker;
- subsetting, shaping closure, or glyph remapping;
- compiled GSUB/GPOS IR;
- SIMD-specific code;
- worker runtime baker;
- persistent runtime-bake cache;
- Slug renderer port;
- MTSDF or Slug generation;
- automatic font fallback;
- automatic presentation selection;
- public React/Three bindings;
- stable file-format or public API promises.

Fixture tooling may assemble existing source/presentation bytes and capture oracles, but it is not a product compiler. This slice proves the full ownership and identity chain before additional fonts, presentation engines, and build-time tooling multiply the surface area.

## Lane A — Shaping

### Build now

- HarfRust reference behavior.
- Runtime registration of original OpenType bytes.
- Source-local glyph IDs scoped by font handle.
- Batched Wasm input/output.
- Exact conformance fixtures.
- Cached font state and shape plans.

### Reserve the lane

- Versioned optional compiled-operation sections.
- Capability bits for operation families.
- Script/language/feature metadata not tied to Latin.
- `yAdvance`/`yOffset` even while vertical layout is deferred.
- Variation-instance identity even while runtime axes are deferred.
- Debug metadata mapping packed IDs back to source IDs outside the hot path.

### Research later

- Direct baked cmap/metric provider.
- Compiled coverage/class/substitution/positioning operations.
- SIMD-assisted kernels.
- Per-font AOT Wasm.
- Script-module code splitting.

### Do not accidentally foreclose

- Do not use JavaScript string index as glyph identity.
- Do not make glyph count equal source character count.
- Do not encode positions as presentation-space floats.
- Do not make reference OpenType tables the only possible shaping section format.
- Do not expose HarfRust internal structs as the file format or public API.

## Lane B — Paragraph layout

### Build now

- Implement the JS/Wasm boundary and required shaping fields.
- One-font paragraph and explicit span model.
- Measured clusters and greedy fixed-width wrapping for the reference fixture.
- Width-only reflow cache and batched boundary-reshape seam.
- Conformance fixtures for clusters, unsafe flags, context ranges, and line source ranges.

### Reserve the lane

- UTF-16 source ranges and style spans.
- Item range distinct from context range.
- Batched multi-range reshape request.
- Logical order distinct from visual order.
- Font index/handle in future positioned output.
- Optional inserted-glyph/source mapping for hyphen and ellipsis.

### Research/build next

- UAX #14 and UAX #29 implementation choice.
- Bidi ownership.
- Font fallback granularity.

### Later

- Balanced wrapping.
- Full language hyphenation.
- Advanced justification.
- Vertical writing.
- editing/IME-specific caret behavior beyond the base cluster model.

### Do not accidentally foreclose

- Do not return only absolute glyph positions from the shaper.
- Do not make wrapping a shaper option.
- Do not discard clusters or unsafe flags after shaping.
- Do not reorder the source string into visual order.

## Lane C — Container and loading

### Build now

- Experimental one-face font asset with original OpenType bytes and one bitmap presentation.
- Versioned binary header/directory sufficient for shaping and direct presentation fixtures.
- Strict range/alignment/capability validation.
- Deterministic test output and golden bytes.

### Reserve the lane

- Presentation directory capable of zero, one, or multiple techniques.
- Unknown optional versus required section behavior.
- Separately addressable/fetchable presentation ranges.
- Compiler, Unicode, and reference-engine provenance.
- `u16`/future wider ID policy encoded at font level.
- Extension versioning independent from GLB container version.

### Build later

- Shared native/Wasm compiler core.
- Worker protocol and limits.
- Persistent content-addressed cache.
- Production baked-first loader surface.

### Later

- Progressive presentation fetching/generation.
- External/shared atlas resources.
- format registration/standardization discussions.

### Do not accidentally foreclose

- Do not require all presentations to be resident before shaping.
- Do not make the entire font one opaque monolithic record with no section evolution.
- Do not define direct-to-GPU as a claim that ignores mandatory decode/upload operations.
- Do not let corrupt baked data silently change typography by falling back to a different shaper without diagnostics.

## Lane D — Presentation

### Build now

- One pre-generated bitmap presentation fixture and renderer plugin.
- Source-local glyph-ID lookup and optional availability contract.
- Flat direct-upload records and WebGPU/WebGL2 proof.
- One positioned paragraph rendered without shaping-specific renderer knowledge.

### Build next

- MTSDF generator/renderer as the proposed general-purpose presentation.
- Slug port/rewrite after its quality corpus and proven optimization baseline are ready.

### Build after first presentation

- Additional bitmap strikes and hinting experiment.
- Explicit recommendation helper; automatic switching remains optional policy.

### Reserve the lane

- Multiple presentations in one font.
- Multiple atlas pages/bitmap strikes.
- Logical, ink, and presentation bounds as distinct concepts.
- Color-layer and image presentation technique IDs.
- Missing-presentation behavior per glyph.

### Later

- COLRv1 paint graph.
- SVG glyphs.
- bitmap/color emoji image formats.
- renderer-specific batching strategies beyond the canonical font format.

### Do not accidentally foreclose

- Do not put advance or kerning in presentation records.
- Do not make Three.js instance attributes the canonical on-disk glyph record.
- Do not assume one presentation per font or one atlas per technique.
- Do not force presentation padding into shared ink/logical bounds.

## Lane E — Baker

### Build now

- No product font compiler or baker.
- Fixture-only assembly of pinned OpenType bytes and already-generated presentation records.
- Oracle capture and deterministic asset validation.

### Reserve the lane

- Host-independent compiler core.
- Canonical outline abstraction consumed by several generators.
- Versioned generator options included in cache/output identity.
- Structured diagnostics and unsupported-feature errors.

### Build next

- Nothing in the current roadmap. Reconsider compiler/baker work after the runtime path is measured.

### Later

- MTSDF and bitmap generators.
- WOFF2 ingestion if it materially affects product use.
- authored bitmap/custom presentation inputs.
- incremental/progressive presentation generation.

### Do not accidentally foreclose

- Do not make the CLI implementation the compiler API.
- Do not parse the source once per presentation generator.
- Do not let native and Wasm hosts make independent format decisions.
- Do not make “all glyphs” the only runtime-bake policy.

## Proposed delivery sequence after rescoping

### Slice 0 — Planning decisions

- Review the discussion extraction.
- Accept/revise the decision register.
- Select versions, licensed corpus, target browsers, and experimental names.
- Confirm the first vertical-slice success criteria.

### Slice 1 — Fixture and reference shaping proof

- Pinned original font and pre-generated bitmap fixture.
- Experimental asset envelope with original glyph IDs.
- HarfRust Wasm batched ABI.
- Three-way conformance and baseline benchmark.

Outcome: runtime shaping is correct, cached, and coarse-grained.

### Slice 2 — Font registry and paragraph proof

- Opaque font handles and multi-font-safe font slots.
- JS measured clusters and greedy wrapping.
- Width-only reflow and batched boundary-reshape seam.

Outcome: one font lays out in a constrained region without identity debt.

### Slice 3 — One bitmap presentation proof

- Flat direct-upload bitmap records.
- WebGPU/WebGL2 renderer plugin.
- Visual and first-frame/GPU baselines.

Outcome: one font completes the full source-to-pixel runtime pipeline.

### Slice 4 — Identity and API hardening

- Register the same fixture under two independent handles.
- Prove cache, layout slot, resource, and disposal isolation.
- Accept/revise the experimental API and data contracts.

Outcome: adding the first real second font is additive rather than a redesign.

### Slice 5 — Second presentation proof

- Add MTSDF based on its proposed general-purpose role.
- Reuse identical shaped and paragraph output.

Outcome: prove the container is genuinely multi-presentation rather than Slug with abstractions.

### Slice 6 — Slug and optimization decision

- Port/rewrite Slug against the same output.
- Reproduce previously proven quality-preserving Slug optimizations.
- Activate autoresearch only after strict quality and A/B harnesses exist.

## Minimum extension points V1 must preserve

These are the small number of architectural lanes worth reserving immediately:

1. Variable-width glyph IDs declared per font.
2. Versioned optional shaping section formats.
3. Multiple independently addressable presentations.
4. Full shaped output fields including vertical components and flags.
5. Source item range distinct from context range.
6. Presentation-independent logical/ink metrics.
7. Source, fixture-generator, and Unicode provenance, with space for a future compiler version.
8. Unknown optional/required capability behavior.

Everything else should be earned by a real use case or benchmark rather than represented with speculative placeholder types.

## Rescope decisions to make now

The next review should answer only these questions:

1. Is HarfRust accepted as the runtime shaping baseline?
2. Is `(FontHandle, LocalGlyphId)` accepted as the V0 identity?
3. Is one font face per asset and many assets per registry accepted?
4. Is a pre-generated bitmap the first presentation proof?
5. Are the provisional shaped/layout buffer fields and view lifetimes acceptable?
6. Which pinned Inter revision, HarfRust commit, HarfBuzz version, and Unicode version define the fixture?
7. Which lanes above are essential to reserve in the first binary/API contracts?

Once answered, the broad phased plan and issue backlog should be rewritten around slices rather than treating every explored feature as V1 work.
