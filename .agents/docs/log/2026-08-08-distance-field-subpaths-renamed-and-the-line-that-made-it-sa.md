---
type: Log Entry
title: 'Distance-field subpaths renamed, and the line that made it safe'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`./raster/mtsdf` and `./three/mtsdf` sat beside `./bakers/msdf`, so a consumer wrote one spelling to bake and another to render. The export paths and the symbols reachable through them now read msdf. The rule that made the change tractable is that identifiers move and string literals do not: a first attempt swept 370 occurrences across the monorepo and broke four separate things, every one of them a literal. The worst was msdfgen's own `mtsdf` CLI mode, which is a different algorithm from its `msdf` mode and would have silently changed what the native quality oracle generates without failing loudly. The others were the baked artifact kind, the packaged schema enum, and fixture filenames. Nothing persisted moved in the landed change: the glTF extension encoding value, the schema enum, the validator's diagnostic codes, the Rust crate and bin target names, the generated ABI module, the baker Wasm filenames, and every fixture filename keep their spelling. The benchmark application keeps `mtsdf` throughout, because its conformance scenario identifiers and `?technique=mtsdf` URL vocabulary appear in checked-in GPU performance evidence and moving them would mean regenerating hardware results for a spelling change; it consumes the renamed package symbols by aliasing them at its ten import sites instead.
