# Scope lanes

Status: rescoping worksheet  
Purpose: decide what to build now without hard-coding away later capabilities.

The original discussion describes an eventual text platform, not a credible first implementation. This document separates four kinds of work:

1. **Build now**: required to prove the product's central contract.
2. **Reserve the lane**: V1 format/API must leave room, but implementation is deferred.
3. **Research later**: valuable only after baselines exist.
4. **Out of scope**: not a product commitment.

“Reserve the lane” does not mean adding placeholder machinery. It means choosing identities, versioning, ownership boundaries, and optional-section behavior that do not require a breaking redesign later.

## Proposed first build: shaping vertical slice

The smallest coherent first build should answer one question:

> Can `pmndrs/text` take a statically instantiated font, bake renderer-independent font identity and reference shaping data into a GLB, and produce HarfRust-conformant shaped buffers in Wasm without coupling the output to a renderer?

### Build now

- one source OpenType font input path for research fixtures;
- static font instance only;
- one deliberately small Unicode/glyph subset plus correct shaping closure;
- dense packed glyph IDs;
- experimental `FL_font` identity, metrics, cmap, and reference-shaping sections;
- narrow GLB validator/reader;
- HarfRust Wasm reference shaper;
- one coarse batched request/output ABI;
- UTF-16 cluster mapping and full scalar decoding;
- glyph IDs, clusters, four positioning values, and flags;
- native test baker only, sufficient to create fixtures;
- HarfBuzz/HarfRust/GLB three-way conformance harness;
- Wasm size, startup, boundary, and shaping baselines.

### Do not build in the first vertical slice

- compiled GSUB/GPOS IR;
- SIMD-specific code;
- worker runtime baker;
- persistent runtime-bake cache;
- JS paragraph engine;
- Slug renderer port;
- MTSDF or bitmap generation;
- public React/Three bindings;
- stable file-format or public API promises.

This slice proves the hardest shared identity and correctness boundary before presentation work multiplies the surface area.

## Lane A — Shaping

### Build now

- HarfRust reference behavior.
- Static font units and one packed glyph-ID space.
- Batched Wasm input/output.
- Exact conformance fixtures.
- Reference shaping data inside the experimental container.

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

- Only document the JS/Wasm boundary and required shaping fields.
- Add conformance fixtures that paragraph layout will later require: clusters, unsafe flags, context ranges.

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
- Measured clusters.
- Greedy wrapping and width-only reflow.
- Boundary reshape policy and cache keys.
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

- Experimental shared font extension only.
- Versioned binary header/directory sufficient for shaping fixtures.
- Strict range/alignment/capability validation.
- Deterministic test output and golden bytes.

### Reserve the lane

- Presentation directory capable of zero, one, or multiple techniques.
- Unknown optional versus required section behavior.
- Separately addressable/fetchable presentation ranges.
- Compiler, Unicode, and reference-engine provenance.
- `u16`/future wider ID policy encoded at font level.
- Extension versioning independent from GLB container version.

### Build next

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

- No production presentation backend in the first shaping slice.
- Define only the packed glyph-ID lookup and optional availability contract.

### Build next

- One presentation end to end, likely Slug because prior art exists.
- Flattened presentation records and direct upload proof.
- One positioned run rendered without shaping-specific renderer knowledge.

### Build after first presentation

- MTSDF generator and renderer.
- Generated bitmap strikes.
- Automatic/manual presentation-selection policy.

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

- Minimal native research baker for the shaping vertical slice.
- Source validation, static instance, subset closure, dense remap, deterministic shared sections.

### Reserve the lane

- Host-independent compiler core.
- Canonical outline abstraction consumed by several generators.
- Versioned generator options included in cache/output identity.
- Structured diagnostics and unsupported-feature errors.

### Build next

- Wasm worker host.
- Transfer/cancellation/resource limits.
- Slug generator port/rewrite.
- Persistent cache.

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

### Slice 1 — Reference shaping proof

- Dense ID/subset fixture baker.
- Experimental shared font sections.
- HarfRust Wasm batched ABI.
- Three-way conformance and baseline benchmark.

Outcome: decide whether the central architecture is viable.

### Slice 2 — One presentation proof

- Port/rewrite Slug presentation only.
- Flat direct-upload records.
- Render shaped output through a standalone adapter.

Outcome: prove shaping/presentation separation and reuse prior work.

### Slice 3 — Paragraph proof

- JS measured-cluster and greedy wrapping engine.
- Width-only reflow.
- Batched boundary reshaping.

Outcome: prove constrained regions without excessive Wasm crossings.

### Slice 4 — Runtime ingestion proof

- Shared portable compiler core.
- Worker fallback and persistent cache.
- Same canonical bytes/load path.

Outcome: prove the non-prebaked product experience.

### Slice 5 — Second presentation proof

- Choose MTSDF or bitmap based on product priority.
- Reuse identical shaped and paragraph output.

Outcome: prove the container is genuinely multi-presentation rather than Slug with abstractions.

### Slice 6 — Optimization decision

- Profile the completed reference system.
- Select zero or more compiled lookup/SIMD experiments.
- Proceed only on measured product benefit.

## Minimum extension points V1 must preserve

These are the small number of architectural lanes worth reserving immediately:

1. Variable-width glyph IDs declared per font.
2. Versioned optional shaping section formats.
3. Multiple independently addressable presentations.
4. Full shaped output fields including vertical components and flags.
5. Source item range distinct from context range.
6. Presentation-independent logical/ink metrics.
7. Compiler and Unicode provenance.
8. Unknown optional/required capability behavior.

Everything else should be earned by a real use case or benchmark rather than represented with speculative placeholder types.

## Rescope decisions to make now

The next review should answer only these questions:

1. Is the first vertical slice reference shaping only, with no production renderer?
2. Is HarfRust accepted as the primary baseline?
3. Is a minimal shaping-only GLB experiment accepted before the full presentation schema?
4. Is Slug the first presentation after shaping proof?
5. Does paragraph layout precede or follow the runtime worker baker?
6. Is the second presentation MTSDF or bitmap?
7. Which lanes above are essential to reserve in the first binary/API contracts?

Once answered, the broad phased plan and issue backlog should be rewritten around slices rather than treating every explored feature as V1 work.
