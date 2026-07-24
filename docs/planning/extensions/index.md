# glTF extension drafts

## Core font

- [PMNDRS_font](PMNDRS_font/README.md) - Core shaping payload, metrics, provenance, and raster directory.

## Raster companions

- [PMNDRS_font_bitmap](PMNDRS_font_bitmap/README.md) - Generated bitmap strikes and textures.
- [PMNDRS_font_distance_field](PMNDRS_font_distance_field/README.md) - MTSDF records and textures for the MSDF raster.
- [PMNDRS_font_slug](PMNDRS_font_slug/README.md) - Slug curve, band, and GPU resources.

These are draft V0 vendor extensions. The [shaping](../shaping-data-contract.md) and [raster](../raster-data-contract.md) contracts are their source of truth, and the [registration draft](../gltf-extension-registration.md) must not be submitted without maintainer approval.

This list records raster packages specified by this repository; it is not a registry enforced by `PMNDRS_font`. External raster packages own their own companion extension, schema, baker, validator, and runtime module and can be referenced by the open core raster directory.
