# glTF vendor-prefix request and extension draft

Status: ready for maintainer review; do not submit until approved by Poimandres maintainers  
Target repository: [`KhronosGroup/glTF`](https://github.com/KhronosGroup/glTF)

## Submission sequence

Khronos treats vendor-prefix reservation and extension specification as separate steps:

1. Open a concise GitHub issue requesting the `PMNDRS` vendor prefix.
2. After the prefix is registered and the format has a stable schema plus working implementations, submit the extension specification through a pull request based on [`extensions/Template.md`](https://github.com/KhronosGroup/glTF/blob/main/extensions/Template.md).

The prefix request does not register, endorse, or ratify `PMNDRS_font`. It reserves a project-owned namespace so experimental assets can use a conforming vendor prefix while the specification matures.

## Prefix-registration issue

### Title

```text
Request for PMNDRS vendor prefix
```

### Body

```markdown
Hello glTF maintainers,

Poimandres would like to request registration of the `PMNDRS` vendor prefix.

- **Project:** Poimandres (pmndrs)
- **Website:** https://pmnd.rs/
- **GitHub organization:** https://github.com/pmndrs
- **Contact:** https://github.com/pmndrs/text/issues

The prefix will be used for experimental glTF 2.0 extensions developed by the Poimandres community. The first planned family, beginning with `PMNDRS_font`, represents baked font assets for real-time graphics: shared shaping and glyph metrics accompanied by optional GPU-ready bitmap, distance-field, or vector-curve presentation data.

This allows font assets to use glTF's existing binary-resource, capability-discovery, and validation model while avoiding source-font parsing and presentation generation in the normal runtime path. Detailed specifications, schemas, examples, and implementation links will be submitted separately after the format and implementations have stabilized.

Thank you.
```

This follows the current [`Prefixes.md`](https://github.com/KhronosGroup/glTF/blob/main/extensions/Prefixes.md) requirements: requested prefix, vendor/project name, and URL or contact information. The organization-level issue tracker is used as the public contact so the registry does not depend on one maintainer’s private email address.

## Maintainer review before submission

- Confirm the registered project name should be `Poimandres` rather than `pmndrs` or another legal/project identity.
- Confirm `https://github.com/pmndrs/text/issues` is the desired public contact.
- Confirm the requested prefix remains `PMNDRS` and is still absent from `extensions/Prefixes.md` immediately before filing.
- Submit from an account authorized to represent the Poimandres project.
- Request the `extension` label if a glTF maintainer does not apply it.
- Do not describe the extension as Khronos-approved, multi-vendor, or production-stable.

## Draft extension specification

The following fills the Khronos extension template for the planned core extension. It is retained here as a pre-submission draft; the schema and implementations are intentionally not claimed complete.

---

# PMNDRS_font

## Contributors

- Poimandres text maintainers, Poimandres, [pmndrs/text](https://github.com/pmndrs/text)

Named specification editors and individual contact information will be added before an extension pull request is opened.

## Status

Draft vendor extension. The binary model and APIs are under design and are not yet stable.

## Dependencies

Written against the glTF 2.0 specification.

The core `PMNDRS_font` extension has no required dependency on another glTF extension. Technique-specific companion extensions may optionally use standardized image or compression extensions, including `KHR_texture_basisu`, when their requirements are met and an appropriate fallback policy is declared.

## Overview

`PMNDRS_font` allows a glTF asset to carry one baked font face as a renderer-independent runtime resource. It defines the font’s identity, metrics, shaping source, provenance, and directory of available glyph presentations. Companion extensions describe how glyphs are drawn, initially through generated bitmap strikes, MSDF/MTSDF atlases, or Slug-style quadratic curve and band data.

Text shaping and glyph presentation are deliberately separate. Runtime shaping returns font-scoped glyph identifiers, clusters, advances, and offsets independent of the selected renderer. Every companion presentation uses the same font-local glyph identifier space and does not duplicate shaping advances or kerning.

The extension addresses a real-time delivery problem not covered by core glTF: applications otherwise need to ship and parse a source OpenType font, generate renderer-specific glyph resources at load time, or rely on unrelated external font/atlas formats. A baked font extension can instead provide validated binary ranges and GPU-ready presentation records in the same container and loading model used for the scene’s other runtime resources.

The design supports:

- one shared shaping/metrics payload with one or more optional presentations;
- direct typed views over flat binary records without per-glyph JSON objects;
- explicit capability discovery through `extensionsUsed` and `extensionsRequired`;
- multiple font assets registered by an application without a global glyph-ID namespace;
- optional presentation implementations that can be loaded independently.

This extension does not define paragraph layout, line breaking, application text content, renderer selection policy, or a new scene node type. It also does not require a client to execute font-provided code.

### Extension family

The current planned vendor-extension family is:

| Extension | Responsibility |
| --- | --- |
| `PMNDRS_font` | Font face, units, glyph-ID width, shaping source, provenance, capabilities, and presentation directory. |
| `PMNDRS_font_bitmap` | Generated grayscale or color bitmap strikes, glyph plane/atlas bounds, page descriptors, and GPU image payloads. |
| `PMNDRS_font_distance_field` | SDF/MSDF/MTSDF glyph records, linear atlas data, page descriptors, and distance-range metadata. |
| `PMNDRS_font_slug` | Quadratic curve data, exact band acceleration data, glyph ranges, paging, and optional vector paint/layer records. |

Each companion extension will receive its own specification and JSON schema. The family structure prevents a loader that supports only one presentation from needing to understand every presentation format.

### Typical asset structure

The final property names remain subject to schema review. This abridged example shows the intended root placement, one font face, and references to flat binary ranges; core `buffers` and `bufferViews` arrays are omitted for clarity:

```json
{
  "asset": { "version": "2.0" },
  "extensionsUsed": [
    "PMNDRS_font",
    "PMNDRS_font_bitmap"
  ],
  "extensionsRequired": [
    "PMNDRS_font",
    "PMNDRS_font_bitmap"
  ],
  "extensions": {
    "PMNDRS_font": {
      "version": 0,
      "font": {
        "opentypeBufferView": 0,
        "glyphCount": 907,
        "glyphIdWidth": 16,
        "unitsPerEm": 2048
      },
      "presentations": [
        {
          "extension": "PMNDRS_font_bitmap",
          "version": 0,
          "required": true
        }
      ]
    },
    "PMNDRS_font_bitmap": {
      "metadataBufferView": 1,
      "payloadBufferViews": [2],
      "ppemX": 16,
      "ppemY": 16,
      "textureFormat": "r8unorm",
      "atlasWidth": 1024,
      "atlasHeight": 1024
    }
  }
}
```

The example illustrates ownership and references only. It is not a normative schema and must not be used as a stable interchange contract.

### Required-extension behavior

An asset whose only usable font or glyph presentation depends on this family must list the corresponding extensions in `extensionsRequired`. An asset may omit a companion extension from `extensionsRequired` only when a conforming fallback presentation exists and is sufficient for the asset’s intended use.

A loader that does not support required font extensions cannot correctly render the font asset and must reject or explicitly skip that dependent application resource. This extension does not redefine the behavior of core glTF scene objects.

## glTF Schema Updates

`PMNDRS_font` adds one extension object to the root glTF object. The object will reference existing glTF `bufferView` and, where applicable, `image` indices. It does not alter the interpretation of core properties.

The normative schema must define:

- extension and binary format versions;
- one-face-per-extension ownership;
- source-local glyph-ID width and count;
- font units and required metrics;
- shaping-source buffer references and declared format;
- provenance and deterministic-bake identifiers;
- presentation entries, required/optional behavior, and extension names;
- range, alignment, count, and resource-limit validation;
- forward-compatible handling of unknown optional capabilities.

All new objects will inherit the appropriate `glTFProperty` or `glTFChildOfRootProperty` schema definitions and allow additional properties in accordance with glTF extension conventions.

### JSON Schema

The JSON schemas are not yet submitted. Before the extension pull request, they will be published in the proposed extension directory and linked here:

- `schema/glTF.PMNDRS_font.schema.json`
- separate schemas owned by each companion presentation extension

The current non-normative binary and ownership design is maintained in the [`pmndrs/text` data-design document](https://github.com/pmndrs/text/blob/feat/planning/docs/planning/DATA_DESIGN_V0.md).

## Known Implementations

- [`pmndrs/text`](https://github.com/pmndrs/text) — planned reference baker, loader, runtime shaper, paragraph engine, and presentation implementations; not yet released.
- [Three Flatland Slug](https://github.com/thejustinwalsh/three-flatland/tree/c596ac2313e33cace825fe197a6d730269019175/packages/slug) — working prior art for baked Slug font data and loading, but not an implementation of `PMNDRS_font`.
- [Three Flatland uikit SVG icon baker](https://github.com/thejustinwalsh/three-flatland/tree/2935a89fcd9999e8a8b3d3b733f7f7302285cd60/packages/uikit-lucide) — working prior art for baked SVG-to-Slug icon sets, but not an implementation of `PMNDRS_font`.

The extension specification should not be submitted as stable until at least the `pmndrs/text` reference implementation, schema validation, and representative assets are public and reproducible.

## Resources

- [`pmndrs/text` project brief](https://github.com/pmndrs/text/blob/feat/planning/docs/planning/PROJECT_BRIEF.md)
- [Architecture](https://github.com/pmndrs/text/blob/feat/planning/docs/planning/ARCHITECTURE.md)
- [Runtime data design V0](https://github.com/pmndrs/text/blob/feat/planning/docs/planning/DATA_DESIGN_V0.md)
- [Renderer capability matrix](https://github.com/pmndrs/text/blob/feat/planning/docs/planning/RENDERER_CAPABILITIES.md)
- [Font payload budget](https://github.com/pmndrs/text/blob/feat/planning/docs/planning/PAYLOAD_BUDGET.md)
- [Conformance plan](https://github.com/pmndrs/text/blob/feat/planning/docs/planning/CONFORMANCE_PLAN.md)
- [Benchmark plan](https://github.com/pmndrs/text/blob/feat/planning/docs/planning/BENCHMARK_PLAN.md)

---

## Format references reviewed

The issue body and draft were calibrated against:

- [`extensions/Prefixes.md`](https://github.com/KhronosGroup/glTF/blob/main/extensions/Prefixes.md), which defines the vendor-prefix request;
- [`extensions/README.md`](https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md), which defines naming, required-extension behavior, schemas, and the extension process;
- [`extensions/Template.md`](https://github.com/KhronosGroup/glTF/blob/main/extensions/Template.md), which supplies the specification headings;
- accepted prefix requests for [BEVY](https://github.com/KhronosGroup/glTF/issues/2497), [KITTYCAD](https://github.com/KhronosGroup/glTF/issues/2344), [MANYFOLD](https://github.com/KhronosGroup/glTF/issues/2398), and [PYTHA](https://github.com/KhronosGroup/glTF/issues/2581);
- representative vendor specifications [`GODOT_single_root`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/GODOT_single_root), [`CESIUM_primitive_outline`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/CESIUM_primitive_outline), and [`MSFT_lod`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/MSFT_lod).

The structure is intentionally concise at the prefix-request stage and explicit about motivation, ownership, fallback, schemas, and implementations in the specification draft.
