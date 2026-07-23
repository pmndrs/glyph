# Shaping data contract V0

Status: contract candidate; implementation and fixture work may correct it only through an explicit format revision
Scope: complete runtime-shaping input for one static OpenType face

## Decision

V0 does not invent a partial GSUB/GPOS representation. Its authoritative shaping payload is a deterministic, shaping-only OpenType SFNT face stored in one glTF `bufferView`. This is a complete and testable contract for HarfRust today, while the project learns which normalized lookup representations are worth compiling later.

This choice is deliberate:

- the first shaper inherits HarfRust's complete OpenType lookup behavior instead of approximating it;
- the baker removes outline, bitmap, color, naming, and hinting data that shaping cannot consume;
- `read-fonts` performs bounded, zero-copy table access over the retained bytes in Wasm;
- JavaScript never parses a font or reconstructs glyph/lookup objects;
- every retained byte is named and charged to the shaping budget;
- a future compiled layout format requires a new declared `shapingFormat`; it cannot silently change V0 bytes.

“No runtime parsing” in V0 therefore means no source-font parsing, decompression, subsetting, rasterization, or JavaScript object construction on the normal load path. HarfRust still reads standard SFNT table structures. Eliminating that last table interpretation is compiler work and is not falsely claimed by this contract.

## Canonical shaping profile: `opentype-sfnt-harfrust-v0`

The payload MUST be a single-face SFNT beginning with an OpenType offset table. TTC/OTC collections and WOFF/WOFF2 envelopes are invalid. Input collections and webfonts MUST be decoded and reduced to one canonical face by the baker.

The SFNT table directory and each retained table MUST be four-byte aligned. Table checksums and `head.checkSumAdjustment` MUST be valid. Tables not listed below MUST NOT appear in the shaping payload.

## Shared shaper data versus per-font data

The font artifact does not duplicate Unicode or script-shaper tables. The dynamically loaded HarfRust Wasm module owns:

- UTF-16 decoding, normalization, Unicode categories, combining classes, mirroring, and default-ignorable behavior;
- HarfRust script shapers, feature scheduling, buffer mutation, cluster merging, and glyph flags;
- reusable `ShaperData` and shape-plan caches;
- the pmndrs batch ABI and flat font-function adapter.

Its Unicode and HarfBuzz-equivalence versions are pinned in the package and repeated in font provenance so an incompatible font/runtime pairing can be diagnosed. Script, language, direction, features, cluster level, and buffer flags are request data, not font data. Bidi resolution, line-break data, and paragraph policy live outside the font artifact.

The pre-implementation size envelope remains 250–600 KiB raw and 90–250 KiB compressed for a minimally wrapped HarfRust Wasm module. This is a hypothesis inherited from the research discussion, not an acceptance claim. The first build records raw, Brotli, instantiated code, Unicode-table, and retained linear-memory costs separately; it replaces these ranges in this document.

### Required tables

| Table | Runtime purpose |
| --- | --- |
| `head` | Units per em and canonical face metadata required by the font reader. |
| `maxp` | Glyph count and glyph-ID bounds. |
| `cmap` | Unicode scalar and variation-sequence to local glyph-ID mapping. |
| `hhea` | Horizontal font metrics and `hmtx` cardinality. |
| `hmtx` | Horizontal advances and side bearings used to initialize glyph positions. |
| `OS/2` | Authoritative typographic metrics and Unicode/font classification used by the runtime contract. |

### Conditional OpenType-layout tables

| Table | Retention rule |
| --- | --- |
| `GDEF` | Retain when present. It supplies glyph classes, mark attachment classes, mark glyph sets, attachment points, and variation stores referenced by layout. |
| `GSUB` | Retain when present. All supported scripts, language systems, features, lookups, and feature variations remain intact. |
| `GPOS` | Retain when present. All supported scripts, language systems, features, lookups, anchors, value records, and variation references remain intact. |
| `kern` | Retain only when present and not made redundant by the bake policy. HarfRust remains authoritative about when legacy kerning applies. |

OpenType extension lookup types are retained inside `GSUB` or `GPOS`; they are not separate tables. All GSUB lookup types 1–8 and GPOS lookup types 1–9 that HarfRust supports remain representable because their original normative table encoding is preserved.

### Static variation policy

One asset represents one fixed variation instance. The initial fixture is a non-variable static font. Variable input is rejected until the baker can deterministically instantiate outlines, metrics, cmap/layout feature variations, and presentation data to the same coordinates.

Consequently, V0 shaping payloads MUST NOT contain `fvar`, `avar`, `gvar`, `cvar`, `HVAR`, `VVAR`, `MVAR`, or `STAT`. Adding runtime variation axes is a format revision, not an undocumented optional path.

### Excluded tables

The shaping payload MUST NOT contain:

- outline and hinting data: `glyf`, `loca`, `CFF `, `CFF2`, `VARC`, `cvt `, `fpgm`, `prep`, `gasp`;
- source presentation data: `COLR`, `CPAL`, `SVG `, `CBDT`, `CBLC`, `EBDT`, `EBLC`, `sbix`;
- metadata unused by shaping: `name`, `post`, `DSIG`;
- vertical-only tables: `vhea`, `vmtx`, `VORG`;
- Apple Advanced Typography tables: `morx`, `kerx`, `ankr`, `trak`, `feat`, `ltag`;
- Graphite tables and deprecated `mort`.

V0 conformance is explicitly the HarfRust OpenType shaper over valid static fonts. A font whose correct layout depends on an excluded shaping system is rejected by the baker with a structured unsupported-font diagnostic.

## Font-function data required after outline removal

HarfRust can query glyph geometry during shaping even though rendering is separate. Fallback mark positioning uses glyph extents, and OpenType Anchor Format 2 identifies a contour point. Removing `glyf`/`loca` or CFF outlines without preserving those answers would make the shaping payload incomplete.

`PMNDRS_font.shaping` therefore includes two flat font-function views alongside the SFNT.

### Glyph extents — 8 bytes per glyph

Dense record indexed by local glyph ID:

| Offset | Type | Field |
| ---: | --- | --- |
| 0 | `i16` | x minimum |
| 2 | `i16` | y minimum |
| 4 | `i16` | x maximum |
| 6 | `i16` | y maximum |

The Wasm adapter computes HarfRust extents in i32 working values. An empty/non-drawing glyph stores zeros.

### Referenced contour points — 8 bytes per record

Sparse records contain only points referenced by retained GPOS Anchor Format 2 tables:

| Offset | Type | Field |
| ---: | --- | --- |
| 0 | `u16` | glyph ID |
| 2 | `u16` | contour point index |
| 4 | `i16` | X coordinate in design units |
| 6 | `i16` | Y coordinate in design units |

Records are sorted lexicographically by `(glyphId, pointIndex)` and unique. If GPOS contains no point anchors, the view is omitted and the count is zero. The baker rejects an unresolved referenced point.

The custom HarfRust font-function adapter uses these views for extents and contour-point requests while standard `cmap`, `hmtx`, GDEF, GSUB, and GPOS access remains zero-copy through the retained SFNT.

### Shaping identity hash

The presentation-binding hash covers every authoritative shaping input, not only the SFNT:

```text
SHA-256(
  UTF8("PMNDRS_font\0v0\0")
  || u32le(sfntByteLength) || sfntBytes
  || u32le(extentsByteLength) || extentsBytes
  || u32le(contourPointByteLength) || contourPointBytes
)
```

The absent contour-point view contributes a zero length and no bytes. This domain-separated encoding is used identically by the baker, loader, cache, and presentation artifacts.

## Identity and duplicated header fields

`PMNDRS_font` repeats a small set of values outside the SFNT so the loader can validate and expose them without a JavaScript table walk:

```ts
interface FontMetricsV0 {
  glyphCount: number
  glyphIdWidth: 16
  unitsPerEm: number
  ascender: number
  descender: number
  lineGap: number
}
```

The serialized values are authoritative for paragraph metrics and MUST agree with the shaping face:

- `glyphCount` equals `maxp.numGlyphs`;
- `unitsPerEm` equals `head.unitsPerEm`;
- V0 SFNT glyph IDs are 16-bit, so `glyphIdWidth` MUST be `16`;
- `ascender`, `descender`, and `lineGap` are signed design-unit values selected by the baker and used directly by layout.

The metric selection policy is fixed: when `OS/2.fsSelection.USE_TYPO_METRICS` is set, use `sTypoAscender`, `sTypoDescender`, and `sTypoLineGap`; otherwise use `hhea.ascender`, `hhea.descender`, and `hhea.lineGap`. The serialized values prevent consumer disagreement.

## Runtime shape ABI

JavaScript and Wasm exchange one batch, never one glyph. All integers are little-endian in Wasm linear memory. Offsets are 32-bit byte offsets from the start of the request or result arena and MUST meet the component alignment of the referenced array.

### Feature record — 16 bytes

| Offset | Type | Field |
| ---: | --- | --- |
| 0 | `u32` | OpenType tag, big-endian tag bytes packed into the integer |
| 4 | `u32` | feature value |
| 8 | `u32` | UTF-16 start, inclusive |
| 12 | `u32` | UTF-16 end, exclusive |

### Run request record — 32 bytes

| Offset | Type | Field |
| ---: | --- | --- |
| 0 | `u32` | font handle |
| 4 | `u32` | UTF-16 text start, inclusive |
| 8 | `u32` | UTF-16 text end, exclusive |
| 12 | `u32` | script tag |
| 16 | `u32` | language-table byte offset; zero means default language |
| 20 | `u32` | first feature record |
| 24 | `u16` | feature count |
| 26 | `u8` | direction: `0` LTR, `1` RTL; all other values invalid in V0 |
| 27 | `u8` | cluster level using HarfRust's pinned numeric mapping |
| 28 | `u32` | buffer flags using HarfRust's pinned bit mapping |

Language strings are UTF-8, length-prefixed by `u16`, and deduplicated within a batch. Text is a contiguous `u16` UTF-16 array. Public clusters always refer to offsets in that original array.

### Result structure-of-arrays

| Array | Type | Count | Meaning |
| --- | --- | ---: | --- |
| `runFontSlots` | `u16` | run count | Index into the result font-handle table. |
| `runGlyphStarts` | `u32` | run count | First glyph in every glyph array. |
| `runGlyphCounts` | `u32` | run count | Glyph count in the run. |
| `glyphIds` | `u16` or `u32` | glyph count | Font-local glyph identity; width is declared per result. |
| `clusters` | `u32` | glyph count | Original UTF-16 source offset. |
| `xAdvances` | `i32` | glyph count | Horizontal advance in design units. |
| `yAdvances` | `i32` | glyph count | Vertical advance in design units. |
| `xOffsets` | `i32` | glyph count | Horizontal placement offset in design units. |
| `yOffsets` | `i32` | glyph count | Vertical placement offset in design units. |
| `glyphFlags` | `u16` | glyph count | Stable pmndrs flag mapping, below. |

V0 glyph flags are:

| Bit | Name | Meaning |
| ---: | --- | --- |
| 0 | `UNSAFE_TO_BREAK` | A line break before this glyph may change shaping. |
| 1 | `UNSAFE_TO_CONCAT` | Concatenating at this boundary may change shaping. |
| 2 | `SAFE_TO_INSERT_TATWEEL` | HarfRust reports safe kashida insertion. |
| 3–15 | reserved | MUST be zero when written and ignored when read. |

The result costs exactly `22 + glyphIdBytes` bytes per glyph across the SoA arrays: 24 bytes for V0 `u16` IDs and 26 bytes if a later asset uses `u32`. Run indexes cost 10 bytes per run before arena alignment.

## Byte accounting

The shaping payload raw byte count is exact:

```text
sfnt bytes = 12 + 16 × retainedTableCount + Σ align4(tableLength)
font-function bytes = glyphCount × 8 + contourPointCount × 8
total shaping bytes = sfnt bytes + font-function bytes
```

Every bake report MUST list each retained table independently:

```ts
interface ShapingPayloadReportV0 {
  format: 'opentype-sfnt-harfrust-v0'
  sfntDirectoryBytes: number
  tables: readonly {
    tag: string
    rawBytes: number
    paddedBytes: number
  }[]
  totalRawBytes: number
  gzipBytes: number
  brotliBytes: number
}
```

The pinned source files provide exact initial costs. Inter contains 2,871 source glyphs and Font Awesome contains 1,403; the smaller 907/350 counts in existing Slug GLBs are presentation subsets and are not valid V0 cardinalities because V0 does not yet compute shaping closure.

| Retained item | Inter raw | Font Awesome raw |
| --- | ---: | ---: |
| SFNT directory | 156 B | 108 B |
| `head` | 54 B | 54 B |
| `maxp` | 32 B | 32 B |
| `cmap` | 25,500 B | 18,682 B |
| `hhea` | 36 B | 36 B |
| `hmtx` | 11,484 B | 5,612 B |
| `OS/2` | 96 B | 96 B |
| `GDEF` | 1,006 B | — |
| `GSUB` | 16,078 B | — |
| `GPOS` | 90,894 B | — |
| Four-byte table padding | 8 B | 4 B |
| **Canonical shaping SFNT** | **145,344 B** | **24,624 B** |
| Dense glyph extents | 22,968 B | 11,224 B |
| **V0 subtotal before sparse points** | **168,312 B** | **35,848 B** |

Sparse contour-point cost is `8 × referencedPointCount` and must be measured from the retained GPOS. The source files are 324,820 B and 426,112 B respectively. The table profile therefore removes 179,476 B from Inter and 401,488 B from Font Awesome before adding font-function data. The conformance corpus must prove the canonical reconstruction.

For capacity planning, a shaped batch with 1,000 V0 glyphs costs 24,000 bytes for glyph arrays plus 10 bytes per run, arena headers, font slots, and alignment. This transient memory is separate from the serialized SFNT and GPU presentation memory.

## Validation

Registration MUST reject:

- a non-SFNT payload, collection, WOFF, or WOFF2 envelope;
- absent required tables or a table outside the whitelist;
- overlapping/out-of-range tables, invalid alignment, invalid checksums, or inconsistent duplicated metrics;
- `glyphIdWidth != 16` for this shaping format;
- variable, AAT, Graphite, or deprecated `mort` shaping dependencies;
- invalid GSUB/GPOS/GDEF references as reported by the pinned font reader;
- missing/misaligned extents, duplicate or unsorted contour points, or a GPOS point anchor without a matching point record;
- a payload exceeding configured byte, table-count, glyph-count, or validation-work limits.

The baker and loader both validate. The loader never trusts a GLB merely because it was produced by project tooling.

## Conformance fixture

For the same static face, text, direction, script, language, features, cluster level, and buffer flags, compare:

1. source font through pinned HarfBuzz;
2. canonical shaping SFNT through pinned HarfRust;
3. canonical `PMNDRS_font` through the Wasm ABI.

The comparison includes glyph count, IDs, clusters, all four positions, and mapped flags. Any optimized font-function or lookup path added later runs against the same canonical input and MUST be bit-for-bit equivalent to path 2 for the supported corpus.
