# pmndrs/text

Planning repository for a renderer-independent text system for pmndrs.

The project is currently in research and design. No runtime API or file format is stable, and no production implementation has started.

Start here:

- [Research](RESEARCH.md)
- [Planning index](docs/planning/README.md)
- [Project brief](docs/planning/PROJECT_BRIEF.md)
- [Architecture](docs/planning/ARCHITECTURE.md)
- [Phased plan](docs/planning/PHASED_PLAN.md)
- [Issue backlog](docs/planning/ISSUE_BACKLOG.md)
- [Open questions](docs/planning/OPEN_QUESTIONS.md)
- [Decision register](docs/planning/DECISION_REGISTER.md)
- [Three Flatland Slug audit](docs/planning/SLUG_AUDIT.md)
- [Conformance plan](docs/planning/CONFORMANCE_PLAN.md)
- [Benchmark plan](docs/planning/BENCHMARK_PLAN.md)
- [Rendering implementation difficulty](docs/planning/IMPLEMENTATION_DIFFICULTY.md)
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
| Highly magnified vector art, hairlines, or overlapping paths | Windfoil, potentially | Promising coverage and band-memory behavior in its target cases, but still experimental and not part of the initial implementation scope. |
| Pixel-art or deliberately raster-styled fonts | Bitmap | Preserves an exact authored raster appearance. |

MTSDF is the proposed general-purpose default when an application has no stronger requirement. Bitmap strikes and Slug are deliberate alternatives, not transparent fallbacks. Windfoil is currently classified as future rendering research rather than a production dependency.

The public API should preserve explicit caller choice. Convenience policy may recommend a technique from projected size and usage, but it should not silently switch renderers or force every rendering engine into an application's bundle. Presentation engines should remain separately importable, tree-shakable, and suitable for dynamic loading.

See [Research: glyph rendering and presentation](RESEARCH.md#glyph-rendering-and-presentation) for the source material and limitations behind this guidance, and the [benchmark plan](docs/planning/BENCHMARK_PLAN.md) for how the recommendations will be tested.
