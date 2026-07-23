# glTF vendor-prefix request and extension submission set

Status: ready for Poimandres maintainer review; do not submit or push without approval
Target: [`KhronosGroup/glTF`](https://github.com/KhronosGroup/glTF)

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

The prefix will be used for experimental glTF 2.0 extensions developed by the Poimandres community. The first extension family represents baked fonts for real-time graphics: one renderer-independent shaping resource plus independently loadable bitmap, distance-field, and analytic-vector glyph presentations.

The design uses glTF buffer views, extension discovery, and validation while allowing a consumer to embed all selected resources in one GLB or load only the presentation required by its renderer. Detailed specifications, schemas, examples, and implementations will be submitted separately as they are validated.

Thank you.
```

This request contains the project, URL, contact, and intended namespace use required by [`extensions/Prefixes.md`](https://github.com/KhronosGroup/glTF/blob/main/extensions/Prefixes.md). It requests a prefix only; it does not claim Khronos approval or multi-vendor status.

## Maintainer checklist

- Confirm the registry name should be `Poimandres` and the requested prefix remains `PMNDRS`.
- Confirm `https://github.com/pmndrs/text/issues` is the public contact.
- Recheck that `PMNDRS` is absent from `extensions/Prefixes.md` immediately before filing.
- File from an account authorized to represent Poimandres.
- Do not submit the extension pull request until the golden assets, schema tests, and first implementation exist.

## Extension specifications

These are no longer illustrative placeholders. They encode the current V0 data contracts and are maintained with the implementation:

| Extension | Specification | Schema | Responsibility |
| --- | --- | --- | --- |
| `PMNDRS_font` | [README](extensions/PMNDRS_font/README.md) | [JSON Schema](extensions/PMNDRS_font/schema/glTF.PMNDRS_font.schema.json) | One static shaping face, metrics, provenance, and presentation directory. |
| `PMNDRS_font_bitmap` | [README](extensions/PMNDRS_font_bitmap/README.md) | [JSON Schema](extensions/PMNDRS_font_bitmap/schema/glTF.PMNDRS_font_bitmap.schema.json) | Generated grayscale/color bitmap strikes. |
| `PMNDRS_font_distance_field` | [README](extensions/PMNDRS_font_distance_field/README.md) | [JSON Schema](extensions/PMNDRS_font_distance_field/schema/glTF.PMNDRS_font_distance_field.schema.json) | MSDF/MTSDF RGBA8 atlas presentations. |
| `PMNDRS_font_slug` | [README](extensions/PMNDRS_font_slug/README.md) | [JSON Schema](extensions/PMNDRS_font_slug/schema/glTF.PMNDRS_font_slug.schema.json) | RGBA16F curves with exact compact band acceleration. |

Shared texture-resource schemas live in [`extensions/schema`](extensions/schema). Before a Khronos pull request, these shared definitions must either be placed at registry-approved paths or duplicated into companion extension directories according to maintainer guidance; that packaging change cannot alter their data model.

## Contract source

- [Shaping data contract V0](SHAPING_DATA_CONTRACT.md)
- [Presentation data contract V0](PRESENTATION_DATA_CONTRACT.md)
- [Runtime data design V0](DATA_DESIGN_V0.md)
- [Runtime and bake API fixture V0](API_SHAPES.md)
- [Payload budget](PAYLOAD_BUDGET.md)

## Submission readiness gate

The extension pull request waits for:

1. schema validation against golden combined and split GLBs;
2. one Node bake and one Worker bake producing identical authoritative records;
3. HarfBuzz/HarfRust/runtime shaping comparison on the pinned fixture;
4. bitmap upload through WebGPU and WebGL2;
5. reciprocal shaping-hash rejection tests;
6. measured section and texture reports;
7. named specification editors and accepted Poimandres ownership.

## Format references reviewed

- [`extensions/Template.md`](https://github.com/KhronosGroup/glTF/blob/main/extensions/Template.md)
- [`extensions/README.md`](https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md)
- [`extensions/Prefixes.md`](https://github.com/KhronosGroup/glTF/blob/main/extensions/Prefixes.md)
- accepted requests for [BEVY](https://github.com/KhronosGroup/glTF/issues/2497), [KITTYCAD](https://github.com/KhronosGroup/glTF/issues/2344), [MANYFOLD](https://github.com/KhronosGroup/glTF/issues/2398), and [PYTHA](https://github.com/KhronosGroup/glTF/issues/2581)
- representative vendor specifications [GODOT_single_root](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/GODOT_single_root), [CESIUM_primitive_outline](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/CESIUM_primitive_outline), and [MSFT_lod](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/MSFT_lod)
