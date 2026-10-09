# Changelog

This file records user-facing package changes. It is hand-authored and intentionally omits CI, benchmark-harness, and commit-history details.

## Unreleased — targets 0.2.0

See the [0.2 migration guide](./MIGRATION-0.2.md) for before/after examples and the archived rename commands.

### Breaking

- Renamed synchronous borrowed glyph reads from `withGlyphs` to `readGlyphs` across core, Three, and TypeGPU, without a compatibility alias. The callback's synchronous lifetime, return value, and exception behavior are unchanged.
- Renamed Three's `Text.breakApart()` to `Text.split()` without a compatibility alias. The frozen `[Glyphs, Decorations | undefined]` result, committed-state requirement, independent ownership, and caller-owned disposal are unchanged.
- `Text.split()` now exposes one dense index over drawable glyphs only. Spaces and other blank layout glyphs remain in `text.glyphs()` but are excluded from detached `Glyphs`; `DetachedGlyph.sourceIndex` is removed, while `fontHandle` and `glyphId` identify the glyph's reusable shape. Use `glyphs.measurements[index]` to align detached transforms instead of indexing full-layout measurements. Indexed detached-glyph methods throw `RangeError` outside `0 <= index < glyphs.count`.
- `TextGroup` now creates a batch boundary by default. Compatible text no longer coalesces across separate top-level authored groups, and hiding a group can skip its owned draws. This makes `TextGroup.visible` intuitive but may increase draw counts and renumber renderer-owned mesh `renderOrder` values in applications that relied on the 0.1.0 global pool. Set `batching="shared"` to retain the 0.1.0 coalescing behavior.
- `Text.set()` with state equivalent to the accepted state no longer forces another publication. Assign `font` or `material` explicitly to force resource restaging.

### Added

- Added optional static-font glyph outlines for any raster format. Bake with `glyph bake --outlines`, then use borrowed `readGlyphs((glyphs) => glyphs.outlineAt(...))`, owned `glyphs().outlineAt()`, or dense detached `Glyphs.outlineAt()` reads. Outline-format metadata and variable-font axes are deferred and are not 0.2 support.
- Added `batching="auto" | "shared" | "group"` to Three, React, and Vue `TextGroup`s. `auto` creates a boundary for a top-level authored group and inherits that boundary through nested automatic groups; `group` forces a nested boundary; `shared` joins the nearest enclosing authored boundary or the implicit root pool.
- Exported `TextGroupBatching` from `@pmndrs/glyph/three`.
- Added `/core`'s `createGlyphPlacements()` for cluster-aware caret and selection geometry from a layout inspection and renderer-owned glyph origins.

### Fixed

- Corrected word wrapping at Unicode-legal boundaries that require local reshaping. Arabic, Devanagari, CJK, and contextual Latin text now fill lines without losing shaping context. Affected line breaks, measurements, and glyph positions may differ from 0.1.0 because the previous output was incorrect.
- Preserved Three transform state across patch-only publications and during replacement publication.
- Corrected indexed transforms for custom materials and refreshed late-added scene siblings before retained transform synchronization.
- Preserved accepted renderer publications when retiring replaced resources throws; failed candidates keep the previous visible state.
- Renamed the private browser module file to `content-digest` so URL filters targeting `fingerprint` do not block font loading or Worker baking. Public fingerprint names and artifact identities are unchanged.
- Preserved Wasm compilation errors for mixed-case `application/wasm` headers when streaming fails.
- Detached accepted Vue text-property snapshots from reactive caller data and retained equivalent React nested-font selections.

### Changed

- React and Vue apply canonical text state directly; wrapping or spying on `Text.set()` is not an adapter lifecycle hook. React no longer re-snapshots `style`, `layout`, `constraints`, and `flow` when their prop identities are unchanged; pass a new object instead of mutating one in place.
- TypeGPU position-only updates now write the retained transform uniform without entering semantic publication. Empty and identical-position updates are no-ops.
- `txt` and `span` now enforce their readonly contract by freezing individual span records as well as the containing array.
- Equivalent framework snapshots and aligned spans retain their identities, and engine requests write directly into the retained request arena to reduce repeated allocations and copies.
- Paint-only updates with unchanged span boundaries reuse shaping; compatible instance-only publications retain draw bindings and update affected buffer ranges.
- Replaced the runtime `ktx-parse` dependency with a bounded native KTX2 payload reader. The general parser remains a development-only correctness oracle.
- Default Wasm loading attempts streaming compilation before buffered fallback for a readable response with an unsupported MIME type.
