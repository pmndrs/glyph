---
type: Log Entry
title: 'Made multi-technique fonts one authored load and one CLI bake'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Direct `glyph bake` arguments now accept a
known input/output, shaping-font Unicode subsetting, Bitmap strikes, MSDF, Slug, and byte-exact check mode. The R3F
hello-world example deletes its custom baker script and invokes only that published CLI for both checked assets. Its
runtime surface now declares the three raster requests once per GLB and receives a position-preserving typed tuple;
the artifact is fetched and registered once while each technique retains its exact option and decoded-data type. The
package now exposes one `glyph` executable with command-specific help and version output; `glyph glyphs` surfaces real
font glyph names as JSON or a bake-ready Unicode set while omitting synthetic `gidN` labels.
