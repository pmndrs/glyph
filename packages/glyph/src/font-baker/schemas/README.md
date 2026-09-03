# Vendored validation schemas

`gltf-2.0/` is the unmodified JSON Schema directory from KhronosGroup/glTF commit
`77b44be7bef26e01fb0b140e3d5bb1716421c5e9`. The downloaded source archive has SHA-256
`0f1e200bb081d1fcc7a976ee40f05f95b406ed80f43836550af96b73e5a64bef`.

`extensions/glTF.PMNDRS_font.schema.json` is an exact package copy of the canonical repository
schema at `.agents/docs/planning/extensions/PMNDRS_font/schema/glTF.PMNDRS_font.schema.json`. A package
test rejects byte drift between the two locations.

The schema bundle is vendored so validation remains deterministic and offline in CI. See
`KHRONOS-SPEC-LICENSE.txt` for the Khronos specification-schema terms.
