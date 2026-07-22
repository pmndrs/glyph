# Issue-sized backlog

Status: proposed  
Sizing: S is roughly one focused PR, M may need two PRs, and L must be split before implementation.

This backlog is ordered by dependency. Issue titles are ready to copy into GitHub after maintainers approve the project brief.

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

### C1. Specify `FL_font` header and section directory — M

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

### C4. Define experimental `FL_font` glTF JSON schema — M

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

## Epic E — Portable baker

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

### E4. Define native/worker baker API and diagnostics — M

Dependencies: C5, E1–E3

Acceptance criteria:

- the compiler core has no host-specific business logic;
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
