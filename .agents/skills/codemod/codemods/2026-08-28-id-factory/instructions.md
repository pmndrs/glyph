# Branded ID factory migration

Use the callable `id` export for every authored identity. `id(name)` creates a domainless ID; prefer a domain method whenever
the value enters a typed Glyph protocol field. Render techniques use `id.technique(technique)`, programs use
`id.program(technique, renderer, variant?)`, and baked resource keys use `id.resource(resource)`.

The transform rewrites kind-string calls, the three former render helper functions, explicitly constructed render-ID
registries, and raster policy `identityRegistry` options. It stops on `renderWireId(name)`: choose a typed domain explicitly
because substituting domainless `id(name)` would change the hash and wire value. Backend policy callbacks receive a collision-checked
`RenderIdFactory`; pass it as `ids` and do not construct another registry.
Review non-code examples after the TypeScript residual inventory is clean.
