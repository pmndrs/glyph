# Changelog

This file records user-facing package changes. It is hand-authored and intentionally omits CI, benchmark-harness, and commit-history details.

## Unreleased — targets 0.2.0

### Breaking

- `TextGroup` now creates a batch boundary by default. Compatible text no longer coalesces across separate top-level authored groups, and hiding a group can skip its owned draws. This makes `TextGroup.visible` intuitive but may increase draw counts and renumber renderer-owned mesh `renderOrder` values in applications that relied on the 0.1.0 global pool. Set `batching="shared"` to retain the 0.1.0 coalescing behavior.
- `Text.set()` with state equivalent to the accepted state no longer forces another publication. Assign `font` or `material` explicitly to force resource restaging.

### Added

- Added `batching="auto" | "shared" | "group"` to Three, React, and Vue `TextGroup`s. `auto` creates a boundary for a top-level authored group and inherits that boundary through nested automatic groups; `group` forces a nested boundary; `shared` joins the nearest enclosing authored boundary or the implicit root pool.
- Exported `TextGroupBatching` from `@pmndrs/glyph/three`.

### Fixed

- Corrected word wrapping at Unicode-legal boundaries that require local reshaping. Arabic, Devanagari, CJK, and contextual Latin text now fill lines without losing shaping context. Affected line breaks, measurements, and glyph positions may differ from 0.1.0 because the previous output was incorrect.
- Preserved Three transform state across patch-only publications and during replacement publication.
- Detached accepted Vue text-property snapshots from reactive caller data and retained equivalent React nested-font selections.

### Changed

- React and Vue apply canonical text state directly; wrapping or spying on `Text.set()` is not an adapter lifecycle hook. React no longer re-snapshots `style`, `layout`, `constraints`, and `flow` when their prop identities are unchanged; pass a new object instead of mutating one in place.
- TypeGPU position-only updates now write the retained transform uniform without entering semantic publication. Empty and identical-position updates are no-ops.
- `txt` and `span` now enforce their readonly contract by freezing individual span records as well as the containing array.
- Equivalent framework snapshots and aligned spans retain their identities, and engine requests write directly into the retained request arena to reduce repeated allocations and copies.
