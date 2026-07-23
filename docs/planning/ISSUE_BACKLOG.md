# Issue-sized backlog

Status: proposed  
Sizing: S is roughly one focused PR, M may need two PRs, and L must be split before implementation.

This backlog is ordered by dependency. Issue titles are ready to copy into GitHub after maintainers approve the project brief.

## Current execution queue — one-font baked/fallback slice

The issues below are the active roadmap. The broader epics remain research/future work unless a current issue explicitly depends on them.

### V0.1. Review bake, loader, runtime API, identity, and data contracts — S

Dependencies: none

Acceptance criteria:

- `(FontHandle, LocalGlyphId)` and layout font slots are accepted or revised;
- one-face-per-asset and many-fonts-per-registry ownership is decided;
- shared-core/Node-host/Worker-host ownership and canonical-path convergence are accepted or revised;
- shaped/layout typed views, memory lifetimes, and explicit presentation selection are reviewed;
- subsetting/remapping, compiled IR, SIMD, MTSDF, and Slug generation remain outside V0.

### V0.2. Pin the font fixture and capture shaping and bitmap oracles — M

Dependencies: V0.1

Acceptance criteria:

- one redistributable font revision, license, source URL, and SHA-256 are recorded;
- HarfRust, HarfBuzz, and Unicode versions are pinned;
- exact UTF-16 cases and field-for-field oracle results are checked in;
- expected bitmap pixels/bounds preserve source glyph IDs and record generator provenance.

### V0.3. Implement the minimal shared baker and Node host — M

Dependencies: V0.2

Acceptance criteria:

- a host-independent request retains shaping bytes and generates one grayscale bitmap strike;
- canonical `PMNDRS_font` bytes contain provenance and flat GPU-ready records;
- Node JS API and thin CLI call the same core;
- the core contains no filesystem/CLI logic and does not subset, remap, or compile layout;
- deterministic output, bake time, peak memory, and size baselines are recorded.

### V0.4. Implement the baked-first loader and lazy Worker fallback — M

Dependencies: V0.1, V0.3

Acceptance criteria:

- a valid baked asset reaches the canonical validator without importing fallback code;
- a miss warns once in development, dynamically imports the runtime baker library, starts its Worker host, imports the selected generator module, and transfers source/result buffers;
- Node and Worker output have identical canonical sections;
- fallback output re-enters the normal canonical load path;
- invalid baked assets produce structured diagnostics; no `forceRuntime` option exists;
- in-flight and completed loads are deduplicated in memory;
- bundle-graph tests prove the common path excludes the runtime baker library, Wasm bake core, and generator modules.

### V0.5. Implement the coarse runtime HarfRust Wasm boundary and registry — M

Dependencies: V0.3, V0.4

Acceptance criteria:

- canonical assets register/dispose through opaque handles and copy shaping bytes once;
- parsed HarfRust state and shape plans are reused;
- one batch returns font-scoped IDs, UTF-16 clusters, four positions, and flags as typed views;
- output matches pinned HarfRust fixtures;
- malformed ranges/counts/pages fail without per-glyph object construction;
- cold/warm size, latency, memory, and boundary-call baselines are recorded.

### V0.6. Implement one-font JS paragraph layout — M

Dependencies: V0.5

Acceptance criteria:

- the reference paragraph shapes and wraps at wide and narrow widths;
- measured clusters and line source ranges have golden outputs;
- ordinary width reflow reuses broad shaping;
- layout includes a font table/slots and never measures with presentation bounds;
- boundary-sensitive ranges use at most one reshape batch.

### V0.7. Render the generated bitmap on WebGPU and WebGL2 — M

Dependencies: V0.4–V0.6

Acceptance criteria:

- explicit bitmap plugin prepares canonical flat records/texture payloads;
- instance generation consumes positioned `(fontSlot, glyphId)` output;
- GPU upload performs no per-glyph reconstruction/repacking;
- clipping/resize references pass on WebGPU and WebGL2;
- first-frame, upload, GPU-time, and GPU-memory baselines are stored.

### V0.8. Harden and review the completed vertical slice — M

Dependencies: V0.2–V0.7

Acceptance criteria:

- cancellation, stale handles, limits, corrupt inputs, disposal, and view invalidation are tested;
- two registrations remain isolated by handle/cache/resource identity;
- main, Node bake, Worker bake, and presentation imports stay separated;
- performance claims link to raw evidence and accepted contracts become ADRs;
- the next font or presentation is additive.

## Epic A — Decisions and reference corpus

### A1. Accept the V1 product and scope brief — S

Dependencies: none

Acceptance criteria:

- maintainers resolve every decision-gate item in `PROJECT_BRIEF.md`;
- edits are reflected in architecture and phase documents;
- deferred features have no implied V1 commitment.

### A2. Pin shaping and Unicode reference versions — S

Dependencies: A1

Acceptance criteria:

- HarfRust, HarfBuzz, and Unicode versions are recorded;
- upgrade policy states how fixture changes are reviewed;
- known HarfRust differences have initial tracking entries.

### A3. License and select the initial font corpus — M

Dependencies: A2

Acceptance criteria:

- corpus covers Latin, Arabic, Devanagari/USE, emoji/ZWJ, icons, and CJK subset;
- redistribution and CI use are documented per font;
- each fixture has text, script, language, direction, and feature cases.

### A4. Audit Three Flatland Slug prior art — M

Dependencies: A1

Acceptance criteria:

- relevant files and algorithms are inventoried;
- each item is classified as port, rewrite, reference only, or retire;
- license/attribution requirements are recorded;
- coupling to Three Flatland types is identified.

Research snapshot: [`SLUG_AUDIT.md`](SLUG_AUDIT.md). Implementation should begin by reviewing and accepting or revising its dispositions rather than repeating discovery.

### A5. Define benchmark methodology and result schema — M

Dependencies: A1, A3

Acceptance criteria:

- cold/warm, cached/uncached, native/Wasm, scalar/SIMD cases are defined;
- browser and machine metadata is recorded with results;
- raw/Brotli/gzip sizes are separate metrics;
- benchmark variance and regression thresholds are documented.

Planning baseline: [`BENCHMARK_PLAN.md`](BENCHMARK_PLAN.md).

## Epic B — Shaping contract experiment

### B1. Specify the experimental shaped-buffer ABI — M

Dependencies: A1, A2

Acceptance criteria:

- request batching, memory ownership, growth, and invalidation are specified;
- output fields include glyph ID, UTF-16 cluster, four positions, and flags;
- ID and coordinate widths have overflow behavior;
- no presentation fields enter the ABI.

### B2. Define three-way conformance fixture format — M

Dependencies: A2, A3, B1

Acceptance criteria:

- one fixture can be run through HarfBuzz, HarfRust, and the experimental shaper;
- every output field can be compared;
- allowlisted differences require a reason and upstream link;
- fixture version metadata is mandatory.

Planning baseline: [`CONFORMANCE_PLAN.md`](CONFORMANCE_PLAN.md).

### B3. Prototype a coarse-grained HarfRust Wasm call — M

Dependencies: B1

Acceptance criteria:

- one call shapes multiple runs or a paragraph batch;
- memory views are reused rather than reconstructed per glyph;
- a benchmark quantifies boundary overhead;
- no optimized lookup IR is introduced.

### B4. Establish conformance and fuzzing harnesses — M

Dependencies: B2, B3

Acceptance criteria:

- representative fixtures pass the pinned HarfRust baseline;
- random/structured Unicode input compares all output fields;
- crashes and malformed-input behavior become reproducible seeds;
- CI duration and corpus tiers are documented.

## Epic C — Binary model and GLB

### C1. Specify `PMNDRS_font` header and section directory — M

Dependencies: A1, B1

Acceptance criteria:

- byte order, widths, alignment, capability bits, and versioning are explicit;
- all offsets are relative to a documented base;
- unknown optional/required behavior is defined;
- golden binary examples and corrupt cases are listed.

### C2. Select and specify the cmap representation — M

Dependencies: C1, A3

Acceptance criteria:

- ASCII, BMP, supplementary-plane, missing glyph, and variation-sequence cases work;
- dense/sparse thresholds are justified with corpus measurements;
- UTF-16 clusters remain independent from Unicode scalar lookup;
- size and lookup benchmarks compare at least two representations.

### C3. Specify shared glyph metrics and properties — S

Dependencies: C1

Acceptance criteria:

- canonical advances, bounds, glyph class, flags, and presentation availability are defined;
- stored and working coordinate widths are distinguished;
- no presentation duplicates shaping metrics.

### C4. Define experimental `PMNDRS_font` glTF JSON schema — M

Dependencies: C1, C2, C3

Acceptance criteria:

- extension locations and buffer-view references are defined;
- GLB and external-buffer cases are considered;
- validator requirements and `extensionsRequired` behavior are explicit;
- the schema is marked experimental.

### C5. Prototype deterministic pack/unpack golden tests — M

Dependencies: C1–C4

Acceptance criteria:

- repeated packs are byte-identical;
- every section has round-trip and corrupt-range cases;
- JS and Rust readers agree on offsets and values;
- no production loader API is exposed.

## Epic D — Presentation specifications

### D1. Specify the presentation directory and availability map — S

Dependencies: C1, C3

Acceptance criteria:

- multiple techniques and multiple strikes/atlases are representable;
- per-glyph absence is explicit;
- future technique IDs can be added without changing shaping data.

### D2. Specify flat Slug presentation data — M

Dependencies: A4, D1

Acceptance criteria:

- glyph-to-curve and glyph-to-band ranges are flat;
- GPU formats, strides, and alignment are explicit;
- prior nested runtime reconstruction is unnecessary;
- port/rewrite decisions cite the audit.

### D3. Specify MSDF/MTSDF presentation data — M

Dependencies: D1

Acceptance criteria:

- plane bounds, atlas bounds, page, distance range, and linear sampling are defined;
- shared advance is not duplicated;
- multi-page and missing-glyph behavior is explicit;
- atlas encoding alternatives are measured before acceptance.

### D4. Specify generated bitmap strike data — M

Dependencies: D1

Acceptance criteria:

- strike ppem, format, sampling, bounds, pages, and availability are defined;
- hinting/oversampling policy is an explicit unresolved or accepted choice;
- shared advance is not duplicated;
- native/Wasm determinism requirements are stated.

### D5. Validate direct GPU upload constraints — M

Dependencies: D2–D4

Acceptance criteria:

- WebGPU and target WebGL upload paths are prototyped;
- required row/section alignment is measured;
- any unavoidable decode/transcode step is named honestly;
- no per-glyph repacking is required.

### D6. Specify Slug color layers and SVG icon-font baking — L

Dependencies: D1, D2, E1

Acceptance criteria:

- COLRv0/COLRv1, OpenType-SVG, and manifest-backed SVG icon support matrices name every accepted, flattened, rasterized, or rejected operation;
- supported vectors bake into ordinary Slug geometry plus flat palette, paint, transform, clip, and layer records;
- shaping continues to return the original font-scoped glyph ID;
- runtime drawing parses no SVG document and executes no script, animation, filter, or external resource;
- generator and renderer remain optional dynamic imports.

### D7. Specify embedded color-bitmap emoji presentation — M

Dependencies: D1, D4, E1

Acceptance criteria:

- CBDT/CBLC and `sbix` extraction, strike choice, origin, bounds, and missing-glyph behavior are explicit;
- color space, premultiplication, texture format, decode/transcode, atlas paging, and GPU upload are specified;
- shared shaping advances and offsets are not duplicated or replaced;
- bitmap-color support remains optional and tree-shakable.

## Epic E — Advanced compiler and baker extensions

The V0 queue already establishes the shared core, Node/Worker hosts, canonical writer, and one bitmap generator. This epic adds optimization and scale features after that foundation is measured.

### E1. Define source-font and canonical-outline interfaces — M

Dependencies: A2, A4

Acceptance criteria:

- one parsed/instanced outline feeds all presentation generators;
- source glyph IDs and packed glyph IDs cannot be confused;
- metrics and outline coordinate conventions are explicit.

### E2. Prototype glyph subsetting and shaping closure — M

Dependencies: A3, E1, C2

Acceptance criteria:

- requested code points expand through retained substitutions/attachments;
- every emitted glyph has canonical metrics;
- missing presentations are reported rather than silently misindexed;
- corpus tests cover ligatures and marks.

### E3. Prototype dense glyph remapping — M

Dependencies: E2, C3

Acceptance criteria:

- cmap, shaping data, and presentation records share the remap;
- `.notdef` behavior is explicit;
- `u16` overflow is rejected or upgrades through a specified path.

### E4. Extend native/worker diagnostics for advanced compilation — M

Dependencies: C5, E1–E3

Acceptance criteria:

- the existing core remains free of host-specific business logic;
- progress, cancellation, warning, and failure records are defined;
- output diagnostics separate shaping and presentation sizes/times.

### E5. Design runtime bake cache identity — S

Dependencies: E4

Acceptance criteria:

- key inputs cover every byte-affecting option/version;
- cache invalidation is deterministic;
- privacy/storage and quota failure behavior are documented.

### E6. Prototype worker transfer and resource limits — M

Dependencies: E4, E5

Acceptance criteria:

- source and result buffers are transferred, not cloned;
- main-thread responsiveness is measured;
- cancellation and hard memory/atlas limits are tested;
- cached output enters the same load path as offline output.

## Epic F — Paragraph engine

### F1. Specify paragraph, span, constraint, and layout models — M

Dependencies: B1

Acceptance criteria:

- source ranges are UTF-16 based;
- logical and visual order are distinct;
- wrap, alignment, height, max-lines, and overflow policies are explicit;
- models do not reference a presentation technique.

### F2. Define measured-cluster and break-opportunity model — M

Dependencies: F1, B1

Acceptance criteria:

- glyph ranges map to source ranges;
- UAX #14 opportunities, UAX #29 boundaries, and shaping unsafe flags are representable;
- ligature, mark, ZWJ, and surrogate cases have fixtures.

### F3. Prototype greedy reflow using cached shapes — M

Dependencies: F2

Acceptance criteria:

- width-only Latin reflow performs no shaping call;
- overlong indivisible clusters have a defined emergency policy;
- line metrics and trailing-space behavior are specified.

### F4. Prototype batched boundary reshaping — M

Dependencies: F3, B3

Acceptance criteria:

- all changed line ranges cross Wasm in one call;
- context range versus emitted range is explicit;
- Arabic, soft-hyphen, contextual, and ellipsis fixtures are included;
- resize benchmark reports reshape ratio and call count.

### F5. Add bidi line ordering and RTL fixtures — M

Dependencies: F1, F4

Acceptance criteria:

- paragraph bidi analysis and per-line visual order are distinct;
- source text is never reversed;
- mixed LTR/RTL line wrapping has reference fixtures.

## Epic G — Optimization experiments

Each issue depends on the reference and benchmark harnesses. None is required to validate the initial product architecture.

### G1. Benchmark direct baked cmap and metrics — M

Dependencies: B4, C2, C3, E3

Acceptance criteria:

- correctness matches the reference path;
- cold/warm speed, size, and memory are reported;
- go/no-go decision is recorded.

### G2. Benchmark compiled coverage/class operations — M

Dependencies: G1

Acceptance criteria: same as G1, with representation-size comparisons.

### G3. Benchmark single substitution and pair positioning IR — M

Dependencies: G2

Acceptance criteria: same as G1, including class and sparse fonts.

### G4. Benchmark ligature and attachment IR — M

Dependencies: G3

Acceptance criteria: same as G1, including Arabic/Indic/mark-heavy fixtures.

### G5. Add SIMD only to profiled kernels — M

Dependencies: G1–G4, A5

Acceptance criteria:

- scalar and SIMD outputs are identical;
- per-kernel and whole-run results are reported;
- short-string regressions and module-size cost are included;
- scalar fallback policy is defined.

### G6. Decide whether per-font AOT Wasm merits a prototype — S

Dependencies: G1–G5

Acceptance criteria:

- decision uses measured interpreter bottlenecks;
- module compilation/cache cost and multi-font payload are included;
- browser-time JIT remains separately scoped.

## Epic H — Autoresearch performance loop

No optimization in this epic can weaken correctness or visual-quality gates. Approximate quality/performance modes require separate product decisions.

### H1. Define the autoresearch experiment manifest and evidence schema — S

Dependencies: A5, B4

Acceptance criteria:

- hypothesis, immutable base commit, changed variables, target workloads, guard workloads, backends, metrics, and quality policy are required;
- result states include accepted, rejected, inconclusive, and variant-only;
- raw samples, generated shader/code output, environment data, and image diffs have stable artifact locations;
- the agent cannot change acceptance criteria after collecting results.

### H2. Build the reproducible interleaved A/B runner — L

Dependencies: H1, D5

Acceptance criteria:

- immutable base and candidate builds run in randomized or alternating order;
- warmup, viewport, DPR, vsync, power/thermal notes, and environment metadata are controlled or recorded;
- medians, tails, dispersion, and confidence/noise thresholds are reported from raw samples;
- WebGPU and WebGL2 are supported where the target renderer supports both;
- local runs never push, merge, publish, or replace baselines.

### H3. Build the strict presentation quality guard corpus — L

Dependencies: B4, D2–D4

Acceptance criteria:

- Latin, Arabic marks, CJK, icons, intricate SVG, grazing curves, holes/overlap, scale, minification, magnification, and transform cases are represented;
- deterministic binary/reference results use exact equality;
- cross-device raster variance is characterized separately from candidate-only differences;
- fixtures and tolerances cannot be modified by the same experiment that relies on them.

### H4. Reproduce proven Three Flatland Slug optimizations — L

Dependencies: D2, H2, H3

Acceptance criteria:

- dynamic loops, shader hoisting, structural expensive branches, compact exact band data, band-list deduplication, and exact bounds are each evaluated independently;
- each retained change has new-repository end-to-end evidence and passes the full quality guard;
- neutral or regressing changes are recorded rather than compounded;
- no lower-precision, approximate-minification, or grazing-quality tradeoff enters the baseline.

### H5. Run the first novel Slug autoresearch campaign — L

Dependencies: H4, licensed dense CJK/icon/SVG corpus

Acceptance criteria:

- adaptive bands and a build-time hull variant are evaluated first;
- a workload-specific variant adds no runtime/bundle cost to sources that do not select it;
- accepted experiments exceed the measured end-to-end noise gate without guard-workload regressions;
- every result is presented for human review as a local evidence commit and is not pushed automatically.
