# pmndrs/text

Planning repository for a renderer-independent text system for pmndrs.

The project is currently in research and design. No runtime API or file format is stable, and no production implementation has started.

Start here:

- [Research](RESEARCH.md)
- [Planning index](docs/planning/README.md)
- [Project brief](docs/planning/PROJECT_BRIEF.md)
- [Architecture](docs/planning/ARCHITECTURE.md)
- [System design diagram](docs/planning/system-design.excalidraw)
- [Runtime API shapes](docs/planning/API_SHAPES.md)
- [Runtime data design V0](docs/planning/DATA_DESIGN_V0.md)
- [One-font vertical-slice roadmap](docs/planning/VERTICAL_SLICE_ROADMAP.md)
- [Tooling and fixtures](docs/planning/TOOLING_FIXTURES.md)
- [Phased plan](docs/planning/PHASED_PLAN.md)
- [Issue backlog](docs/planning/ISSUE_BACKLOG.md)
- [Open questions](docs/planning/OPEN_QUESTIONS.md)
- [Decision register](docs/planning/DECISION_REGISTER.md)
- [Three Flatland Slug audit](docs/planning/SLUG_AUDIT.md)
- [Conformance plan](docs/planning/CONFORMANCE_PLAN.md)
- [Benchmark plan](docs/planning/BENCHMARK_PLAN.md)
- [Rendering implementation difficulty](docs/planning/IMPLEMENTATION_DIFFICULTY.md)
- [Renderer capability matrix](docs/planning/RENDERER_CAPABILITIES.md)
- [Autoresearch optimization protocol](docs/planning/AUTORESEARCH.md)
- [Original discussion extraction](docs/planning/DISCUSSION_EXTRACTION.md)
- [Scope lanes](docs/planning/SCOPE_LANES.md)

The existing [`three-flatland/packages/slug`](https://github.com/thejustinwalsh/three-flatland/tree/main/packages/slug) work is prior art and a source for selected algorithms and data formats. This repository is intended to become the shipping product; Three Flatland should eventually consume it.

## Which renderer should I use?

The current recommendation is to choose a presentation technique explicitly while sharing the same shaping and paragraph-layout result. These are research-informed starting points, not final performance guarantees; the project benchmark suite must validate them across representative fonts, sizes, transforms, and devices.

| Usage | Recommended technique | Why |
| --- | --- | --- |
| General-purpose UI and scalable text | MTSDF | Near-atlas rendering cost across a useful scale range, with good corner reproduction and effects support. |
| Tiny text at known pixel sizes | Generated bitmap strike | Fastest path and potentially the best small-size legibility, particularly when hinting is available. |
| World-space text with substantial minification | MTSDF | Texture sampling, mipmaps, and bounded per-pixel work suit text moving away from the camera. |
| Large text, extreme zoom, or complex outlines | Slug | Preserves source-outline detail without a fixed atlas-resolution ceiling. |
| Color emoji and SVG icon fonts | Slug feature set | Bake COLR, OpenType-SVG, or manifest-backed SVG icon artwork into Slug-compatible geometry/paint records; retain embedded color bitmaps as GPU-ready image presentations. |
| Deeply zoomable, overlap-heavy general vector art | Windfoil, outside this text roadmap | Its credible niche is vector editors, generative art, and print-scale rendering—not ordinary text or XR UI. |
| Pixel-art or deliberately raster-styled fonts | Bitmap | Preserves an exact authored raster appearance. |

MTSDF is the proposed general-purpose default when an application has no stronger requirement. Bitmap strikes and Slug are deliberate alternatives, not transparent fallbacks. The Slug feature set is required to support color emoji and SVG icon fonts after the first vertical slice. Windfoil is a general-vector research reference, not a planned `pmndrs/text` backend.

The public API should preserve explicit caller choice. Convenience policy may recommend a technique from projected size and usage, but it should not silently switch renderers or force every rendering engine into an application's bundle. Presentation engines should remain separately importable, tree-shakable, and suitable for dynamic loading.

See [Research: glyph rendering and presentation](RESEARCH.md#glyph-rendering-and-presentation) for the source material and limitations behind this guidance, and the [benchmark plan](docs/planning/BENCHMARK_PLAN.md) for how the recommendations will be tested.

The [renderer capability matrix](docs/planning/RENDERER_CAPABILITIES.md) compares game-facing color, outlining, shadows, effects, color emoji, SVG icons, scale behavior, and technique limits across bitmap, MSDF/MTSDF, and Slug presentations.
