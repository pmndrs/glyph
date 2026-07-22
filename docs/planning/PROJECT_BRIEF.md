# Project brief

Status: proposed  
Audience: pmndrs maintainers and initial contributors

## Product statement

`pmndrs/text` will be a renderer-independent text system for JavaScript and WebGPU/WebGL ecosystems. It will shape modern Unicode text once, lay it out within application-controlled regions, and render the resulting glyph stream through interchangeable Slug, MSDF/MTSDF, or bitmap presentations.

The package is the shipping successor to the text/font work explored in Three Flatland's Slug package. Selected Slug algorithms and formats may be ported or rewritten, while Three Flatland should eventually depend on `pmndrs/text`.

## Problem

Existing web graphics text solutions commonly couple layout to one atlas or renderer, parse source fonts at runtime, use incomplete cmap/kerning logic, or produce object-heavy data that must be repacked before GPU use.

We need:

- modern script shaping and cluster semantics;
- bounded paragraph layout that reflows efficiently;
- a small normal-path runtime;
- pre-baked GPU-ready assets;
- a worker fallback for ordinary font files;
- one shaped result usable by several rendering techniques;
- measurable compatibility with HarfRust/HarfBuzz.

## Primary users

- pmndrs renderer and framework maintainers;
- Three.js and React Three Fiber applications;
- Three Flatland as an initial downstream consumer;
- applications with UI text, 3D labels, icons, bitmap styles, or mixed presentation needs;
- library authors who need shaping/layout without adopting one renderer.

## V1 user outcomes

1. Load a pre-baked font package and shape Unicode text without source-font parsing on the main thread.
2. Load an ordinary supported font and receive the same canonical representation after worker baking.
3. Lay text into a constrained width/height and reflow it without reshaping everything unnecessarily.
4. Render the same positioned glyph stream with Slug, MTSDF/MSDF, or generated bitmap data.
5. Verify shaping output against pinned HarfRust and HarfBuzz references.
6. Upload presentation buffers without per-glyph JavaScript reconstruction or numeric repacking.

## V1 scope

- horizontal LTR and RTL shaping;
- full Unicode scalar input with UTF-16 cluster offsets;
- OpenType shaping supported by the pinned HarfRust baseline;
- static variable-font instances;
- one dense packed glyph-ID space;
- source subsetting plus shaping closure;
- pre-baked GLB and lazy worker fallback;
- Slug, MSDF/MTSDF, and generated bitmap presentations;
- JS paragraph engine with greedy wrapping, alignment, height/max-lines, clipping, and ellipsis;
- batched boundary reshaping;
- conformance fixtures and benchmark harnesses.

## Explicit non-goals for V1

- replacing HarfRust script shaping;
- browser-time JIT or MLIR;
- GPU compute shaping;
- runtime variable-font axes;
- vertical writing;
- Graphite and deprecated AAT `mort`;
- COLRv1/SVG presentation;
- complete locale-specific hyphenation;
- standardizing a Khronos extension before the internal format stabilizes;
- promising numeric speed or size gains before benchmarks.

## Success criteria

### Correctness

- The supported corpus matches pinned HarfRust output field-for-field.
- Differences from pinned HarfBuzz are tracked with an explicit allowlist and rationale.
- Cluster, unsafe-break, and boundary reshape tests cover ligatures, combining marks, Arabic, Indic, bidi, emoji ZWJ, and variation selectors.

### Architecture

- Shaped output contains no presentation-specific fields.
- A single packed glyph ID indexes every included presentation.
- Offline and worker baking produce equivalent canonical sections.
- Paragraph layout makes at most one batched shaping call for a text/style change and zero or one for width-only reflow.

### Loading and rendering

- Pre-baked load performs no OpenType parsing.
- Presentation records need no per-glyph JS objects or value conversion before upload.
- One test paragraph switches among all available presentations without reshaping.

### Evidence

- Every performance claim links to a reproducible benchmark.
- Size reports include raw and compressed Wasm, shaping data, and presentation data separately.
- Runtime-bake tests record time, peak memory, cache behavior, and native/Wasm output parity.

## Product risks

- HarfRust integration may not expose the provider boundary needed for compiled lookup replacement.
- Runtime baking and large font subsets can exceed acceptable worker time or memory.
- GLB image/compression choices may conflict with truly upload-ready texture data.
- “Direct-to-GPU” alignment requirements differ across WebGL/WebGPU paths.
- Correct line-boundary shaping and bidi behavior can invalidate overly aggressive JS-side slicing.
- Three presentation generators increase fixture and visual-regression cost.

## First decision gate

Before production code, maintainers should accept or revise:

1. HarfRust as the reference shaper.
2. GLB plus the `FL_font` extension family as the container.
3. JS paragraph policy with coarse Wasm shaping calls.
4. Static font instances in V1.
5. The worker fallback as a required product feature.
6. The initial presentation set: Slug, MTSDF, and generated grayscale bitmap strikes.
