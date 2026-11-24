# HarfRust fork carried by pmndrs/glyph

This directory is the published `harfrust` 0.12.0 crate with four cargo features, one constructor,
three inlining attributes, three keyed plan-compile sorts, a per-property split of the generated Unicode table, one additive module (`SimpleTextPlan`) and one additive glyph flag (`UNSAFE_TO_CONCAT_BEYOND_PAIRS`) added. It is wired into `packages/glyph/rust/shaper` and `packages/glyph/rust/font-baker`
with `[patch.crates-io]`, so both manifests still ask for `harfrust = "0.12.0"`.

## Base

- crate: `harfrust` 0.12.0 from crates.io, checksum
  `c03d949a14aa089bbb282f7dd76a498a7f684428e4257202efc119ec010376f9`
- upstream commit: `60b28ea22b5261710018d69c168a762bcb28794c`, path `harfrust/` in
  <https://github.com/harfbuzz/harfrust>
- kept verbatim: `LICENSE`, `README.md`, `Cargo.lock`, and every file under `src/` not listed below
- left out of the crate package: `Cargo.toml.orig`, `.cargo_vcs_info.json`, `.cargo-ok`

`Cargo.toml` is the normalized manifest cargo publishes, not upstream's workspace manifest.

## What the fork changes

With default features the fork shapes exactly like the release. The features are on by default so
the same patch can be offered upstream; pmndrs/glyph depends on the crate with
`default-features = false` and turns all four off in the shipped shaper.

### `aat` feature (default on)

Off removes Apple Advanced Typography shaping: `morx`, `kerx`, `trak`, `ankr` and `feat`. Legacy
OpenType `kern` stays in every configuration. Upstream reaches `kern` through `AatCache`,
`AatTables` and `AatApplyContext`, so those types stay and only their AAT members are gated.

| File                                                          | Change                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cargo.toml`                                                  | `aat = []`, added to `default`                                                                                                                                                                                                                                                                                                                      |
| `src/hb/aat/mod.rs`                                           | `layout`, `layout_kerx_table`, `layout_morx_table`, `layout_trak_table` and `map` compile only with `aat`; `layout_common` always compiles. The `morx`/`kerx` members of `AatCache`, the `morx`/`ankr`/`kerx`/`trak`/`feat` members of `AatTables`, the code that fills them and `is_morx_blocklisted` are gated. The `kern` members are untouched. |
| `src/hb/aat/layout_common.rs`                                 | Now owns `DELETED_GLYPH` (moved from `layout.rs`) and the `SimpleKerning` trait (moved from `layout_kerx_table.rs`), because `kerning.rs` needs both. `AatApplyContext::range_flags` and `subtable_flags` are gated. One module attribute allows dead code and unused imports without `aat`.                                                        |
| `src/hb/aat/layout.rs`, `src/hb/aat/layout_kerx_table.rs`     | Re-export the two moved items, so paths inside the AAT modules are unchanged.                                                                                                                                                                                                                                                                       |
| `src/hb/kerning.rs`                                           | Imports the two moved items from `layout_common`. No other change.                                                                                                                                                                                                                                                                                  |
| `src/hb/ot_shape.rs`                                          | Without `aat`: `apply_morx` and `has_kerx` are `false`, the AAT map is not built, and the calls to `aat::layout::{substitute, position, track, remove_deleted_glyphs}` are compiled out. `substitute_plan` and `position_by_plan` were restructured from `if / else` to gated early blocks with the same control flow.                              |
| `src/hb/ot_shape_plan.rs`                                     | `aat_map` is gated; `apply_kerx`, `apply_morx`, `apply_trak` stay and are always `false` without `aat`.                                                                                                                                                                                                                                             |
| `src/hb/face.rs`                                              | `apply_trak` is `false` without `aat`.                                                                                                                                                                                                                                                                                                              |
| `src/hb/buffer.rs`, `src/hb/ot_layout.rs`, `src/hb/tables.rs` | Attributes only: helpers and table ranges used solely by AAT are gated or allowed to be unused.                                                                                                                                                                                                                                                     |

### `rand` feature (default on)

Off removes random alternate selection. The shaper no longer enables the OpenType `rand` feature
by default, and `AlternateSet::apply` never draws a random index, so a font with a GSUB `rand`
feature shapes as upstream does with `rand=0`.

| File                           | Change                                                               |
| ------------------------------ | -------------------------------------------------------------------- |
| `Cargo.toml`                   | `rand = []`, added to `default`                                      |
| `src/hb/ot_shape.rs`           | The default `enable_feature(b"rand", F_RANDOM, MAX_VALUE)` is gated. |
| `src/hb/ot/gsub/alternate.rs`  | The randomizing branch is gated.                                     |
| `src/hb/ot_layout_gsubgpos.rs` | `random_state` and `random_number` are gated.                        |
| `src/hb/ot_map.rs`             | `hb_ot_map_t::MAX_VALUE` is gated; `rand` was its only user.         |

### `language-tags` feature (default on) and `ShapePlan::new_with_language_tags`

Off removes BCP 47 to OpenType language-system resolution: the generated `tag_table` module (a
~150-rule `match` and the 1,433-row `OPEN_TYPE_LANGUAGES` table) and `tags_from_language`. A plan
then takes language systems only from an `-x-hbot` subtag or from the caller.

`ShapePlan::new_with_language_tags(font, direction, script, language, language_tags, features)`
exists in every configuration. It builds the plan `new` builds, except that the OpenType language
systems are `language_tags`, best first, instead of what `language` resolves to; `language` still
identifies the plan and still supplies an `-x-hbsc` script override. With `language-tags` on,
`harfrust::opentype_language_tags(&Language)` returns the tags `new` would resolve, which is what a
caller-side resolver is tested against.

pmndrs/glyph resolves in `packages/glyph/rust/shaper/src/language_tags.rs` from tables generated
out of this crate's `tag_table.rs`, and its differential test compares it with
`opentype_language_tags` over every table key, every rule and random tags. `-x-hbot` alone could not
carry the result: HarfRust resolves up to three candidate tags (`zh-Hant-MO` is `ZHTM`, then `ZHH`)
and the GSUB and GPOS tables each take the first one the font has, and a three-letter fallback such
as `i-a` resolves to a tag (`I-A `) that a private-use subtag cannot spell.

| File                      | Change                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cargo.toml`              | `language-tags = []`, added to `default`                                                                                                                        |
| `src/hb/mod.rs`           | `tag_table` compiles only with `language-tags`; `tag` is `pub(crate)` for the re-export.                                                                        |
| `src/hb/tag.rs`           | `tags_from_script_and_language_with` takes optional caller tags; `tags_from_language` and the `tag_table` helpers are gated; `opentype_language_tags` is added. |
| `src/hb/ot_map.rs`        | `hb_ot_map_builder_t::new` passes the caller tags through.                                                                                                      |
| `src/hb/ot_shape.rs`      | `hb_ot_shape_planner_t::new` passes the caller tags through.                                                                                                    |
| `src/hb/ot_shape_plan.rs` | `new` and `new_with_language_tags` share one private `build`.                                                                                                   |
| `src/hb/common.rs`        | `TagExt::to_uppercase` may be dead without `language-tags`.                                                                                                     |
| `src/lib.rs`              | Re-exports `opentype_language_tags` with `language-tags`.                                                                                                       |

`tags_from_language` keeps its `#[inline(never)]` from the earlier seam, so with the feature on it
stays one function in an optimized binary.

### `SimpleTextPlan` (additive, not offered upstream)

`src/hb/simple_text.rs` is new and nothing in the shaper calls it, so `shape` is unchanged. A
`SimpleTextPlan` is derived from a `ShapePlan` and holds the glyphs some lookup of that plan can
start a match on. `SimpleTextPlan::shape` turns a buffer whose characters all avoid that set, and
avoid every Unicode stage that looks past one character, into the glyph buffer `shape` would
return, and hands any other buffer back untouched. The module header gives the argument stage by
stage; `packages/glyph/rust/shaper/src/simple_text_tests.rs` shapes every accepted item a second
time with `shape` and compares each glyph, cluster, flag, advance and offset.

| File                    | Change                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/hb/simple_text.rs` | New module.                                                                                                        |
| `src/hb/mod.rs`         | Declares it.                                                                                                       |
| `src/lib.rs`            | Re-exports `SimpleTextPlan`.                                                                                       |
| `src/hb/ot/lookup.rs`   | `SubtableInfo::primary_coverage`: re-reads the coverage table a subtable's digest was built from. No other change. |

### `variations` feature (default on)

Off makes every font shape at its default instance: `OtTables::active_coords` is always empty,
`OtTables::active_var_store` is always `None` and a `ShaperInstance`'s feature-variation indices are
ignored, so the GDEF/HVAR/VVAR/MVAR and `gvar` delta paths are not linked. `ShaperInstance` still
exists and still computes its coordinates; they simply have no effect. pmndrs/glyph never passes an
instance (the shaper shapes baked fonts at their default instance), so its shaping is unchanged.
Variable-font shaping needs the feature back on: FeatureVariations selection, GPOS and GDEF
variation deltas and HVAR/`gvar` advances are all behind it. In the shipped shaper it costs 13,165
raw / 5,151 gzip bytes (measured 2026-11-22). The last two rows compile out calls that already returned
nothing without coordinates; they removed a further 1,585 raw / 662 gzip bytes (measured 2026-11-23).

| File                                     | Change                                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Cargo.toml`                             | `variations = []`, added to `default`                                                                                               |
| `src/hb/ot/mod.rs`                       | Constructors drop coordinates and feature-variation indices without `variations`; `active_coords` and `active_var_store` read them. |
| `src/hb/ot/gpos/mod.rs`                  | Value-record deltas read `active_var_store` and `active_coords`.                                                                    |
| `src/hb/font_funcs.rs`, `src/hb/face.rs` | Metrics and `Shaper::coords` read `active_coords`.                                                                                  |
| `src/hb/glyph_metrics.rs`                | MVAR ascender/descender deltas (vertical origin fallback) read MVAR through `mvar_deltas`, which is `None` without `variations`.    |
| `src/hb/ot_map.rs`                       | The map compiler's feature-variation index is `None` without `variations`, so FeatureVariations substitution is not linked.         |

### Plan-builder helpers out of line

`hb_ot_map_builder_t::add_feature` is `#[inline(never)]` instead of `#[inline]`. Plan building
calls it (directly and through `enable_feature`/`disable_feature`) from dozens of sites in the
complex shapers and `ot_shape`, and every inlined copy carried the `Vec` push. Plans are built
once per font, script and feature set and cached, so the extra call is off the shaping path. In
the shipped shaper it removed 6,133 raw / 1,243 gzip / 856 Brotli bytes (measured 2026-11-23).
`add_pause`, behind `add_gsub_pause`/`add_gpos_pause`, is `#[inline(never)]` for the same reason:
3,673 raw / 505 gzip / 566 Brotli.

### Unicode table split per property

Upstream's `src/hb/ucd_table.rs` is HarfBuzz packtab output that stores the sub-arrays of every
property (general category, combining class, mirroring, script, decomposition) in two shared
statics, `_hb_ucd_u8` and `_hb_ucd_u16`. A linker keeps a static whole, so the script property's
15,241-byte region stayed linked in pmndrs/glyph although its only reader,
`UnicodeBuffer::guess_segment_properties`, is never called (runs carry their script).

The upstream file is kept verbatim as `src/hb/ucd_table_upstream.rs`, compiled only for tests.
`tools/split-ucd-table.mjs` generates `src/hb/ucd_table.rs` from it: each property gets its own
`_hb_ucd_<property>_u8` / `_u16` statics holding exactly its region, and its indices are rebased by
the region's start. Values, stage shifts and lookup order are unchanged. The generated
`ucd_table::tests::every_property_equals_upstream_at_every_code_point` compares all five lookups
with upstream's at every one of the 1,114,112 code points. In the shipped shaper the split removed
13,976 raw / 4,820 gzip / 4,047 Brotli bytes (measured 2026-11-23 at `sil-green-64`).

| File                           | Change                                                         |
| ------------------------------ | -------------------------------------------------------------- |
| `src/hb/ucd_table_upstream.rs` | Upstream's `ucd_table.rs`, renamed, byte-for-byte.             |
| `src/hb/ucd_table.rs`          | Generated by `node vendor/harfrust/tools/split-ucd-table.mjs`. |
| `src/hb/mod.rs`                | Declares `ucd_table_upstream` under `#[cfg(test)]`.            |
| `tools/split-ucd-table.mjs`    | New: the generator.                                            |

### `FontInstance` support only with `experimental_font_api`

Upstream compiles the `FontKind::FontInstance` variant, `Shaper::from_font`, `impl AnyFont for
FontInstance` and the `from_tables` constructors they use (`ShaperData::from_font`,
`OtTables::from_tables`, `AatTables::from_tables`, `Charmap::from_tables`) in every configuration,
although only the `experimental_font_api` feature exposes a `FontInstance` to callers. The fork
compiles them, and the `FontInstance` match arms in `face.rs`, `font_funcs.rs` and
`glyph_names.rs`, only with that feature. Without it a shaper is always built from a `FontRef`, so
nothing observable changes, and the read-fonts `FontTables` model paths are no longer linked.
`shape` (the experimental entry point) is compiled only with the feature too, instead of being
allowed to be dead.

### Plan-compile sorts in `ot_map.rs` through `u64` keys

`dedup_feature_infos` and the map compiler's per-stage lookup sort used `sort()` on
`feature_info_t` and `lookup_map_t`, which links a driftsort per element type. The fork lowers each
order to `u64` keys and sorts those with `sort_unstable`, the one instantiation the embedding shaper
already links for its own keys:

- `sort_feature_infos`: key `(tag as big-endian u32) << 32 | seq`. `Tag` orders its bytes
  lexicographically, which is big-endian `u32` order, and before deduplication `seq` is each
  entry's position, so the key's low half names the source entry and the order is the derived
  `(tag, seq, ...)` order, total because `seq` is unique.
- `sort_lookup_maps`: every field of `lookup_map_t` packs into 52 bits in declaration order
  (`index`, `auto_zwnj`, `auto_zwj`, `random`, `mask`, `per_syllable`), so sorting the keys and
  unpacking them is the derived sort exactly.

- `map_features.sort()` (simple maps only) orders by tag alone and is stable, and a simple map can
  hold one tag twice. `sort_by_tag_then_position` keys it `(tag as big-endian u32) << 32 |
position`, which is that stable order; `sort_feature_infos` uses the same helper, since its
  `seq` is the position.

All three produce the same sequence as upstream, and the shaper links no sort over a HarfRust map
type. In the shaper the two cuts removed `18,118` raw / `5,751` gzip and `5,456` raw / `1,728`
gzip.

### `UNSAFE_TO_CONCAT_BEYOND_PAIRS` (additive, not offered upstream)

`UNSAFE_TO_CONCAT` says some stage examined a range of glyphs that holds this one, but not which
stage. A `PairPos` lookup whose first-glyph coverage holds the space (Fredoka's `kern`) examines
every adjacent pair, so every glyph of a paragraph carries the flag and no boundary is left where a
caller could splice a reshaped piece of the text in.

With the buffer flag `BufferFlags::PRODUCE_UNSAFE_TO_CONCAT_BEYOND_PAIRS` (`0x100`) next to
`PRODUCE_UNSAFE_TO_CONCAT`, the shaper also sets `GlyphFlags::UNSAFE_TO_CONCAT_BEYOND_PAIRS` on
every glyph of an examined range except the range's first cluster, unless the range is a simple
pair: a `PairPos` match or miss with an empty second value record whose second glyph directly
follows the first. Such a pair reads nothing but its two glyphs and writes nothing but their
positions and flags. A second value record makes the lookup step over the second glyph, so the
pairs it visits depend on every pair before it, and a skipped glyph between the two is read as
well; both keep the flag. The legacy `kern` table keeps it too: it flags the whole buffer when any
pair of it can match, which no piece of the text can know.

The flag is clear on a cluster exactly when nothing but simple pairs reaches across the boundary
before it. It shares its bit (`0x4`) with `SAFE_TO_INSERT_TATWEEL` and is not produced when
`PRODUCE_SAFE_TO_INSERT_TATWEEL` is set. Without the buffer flag nothing changes: the mask bit is
never set and every other flag is as upstream sets it.

| File                     | Change                                                                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib.rs`             | `BufferFlags::PRODUCE_UNSAFE_TO_CONCAT_BEYOND_PAIRS`; `BufferFlags::DEFINED` is `0x1FF`.                                                                                                                                           |
| `src/hb/buffer.rs`       | `GlyphFlags::UNSAFE_TO_CONCAT_BEYOND_PAIRS`; `unsafe_to_break`, `unsafe_to_concat` and their `_from_outbuffer` forms add it to the range's interior; `unsafe_to_break_pair` and `unsafe_to_concat_pair` are the forms that do not. |
| `src/hb/ot/gpos/pair.rs` | `PairPosFormat1` and `PairPosFormat2` call the `_pair` forms for a simple pair (`simple_pair`), and for a first glyph with nothing after it yet.                                                                                   |

## Checks

```sh
# the fork against the crates.io release, as glyph consumes it and as upstream would ship it
mise exec -- pnpm scripts run glyph:harfrust-fork-tests

# every feature combination builds with no warning
for features in libm libm,aat libm,rand libm,language-tags libm,variations std std,aat std,rand std,language-tags std,variations std,aat,rand,language-tags,variations,experimental_font_api; do
  cargo check --locked --manifest-path vendor/harfrust/Cargo.toml --no-default-features --features "$features"
done
```

The package test (`pnpm --filter @pmndrs/glyph test`) runs the first command, which also runs the
fork's own unit tests (`cargo test --release --lib` on this crate). `vendor/harfrust-parity`
shapes its fixtures and the repository's shaping corpus through both crates and compares every
glyph ID, cluster, flag, advance and offset. Its fixtures have no AAT tables, so it does not
exercise `morx`, `kerx` or `trak` in either configuration; upstream's own test suite is not part of
the published crate and is not vendored.

## Cutting an upstream pull request

1. Check out upstream at the base commit and copy `src/` over `harfrust/src/`.
2. In `harfrust/Cargo.toml` add `aat = []`, `language-tags = []`, `rand = []` and `variations = []`
   under `[features]` and add all four to `default`.
3. Drop this file, `src/hb/simple_text.rs`, its `mod` and re-export lines,
   `SubtableInfo::primary_coverage` and the `UNSAFE_TO_CONCAT_BEYOND_PAIRS` changes. Restore `src/hb/ucd_table.rs` from `ucd_table_upstream.rs`
   (the split belongs in upstream's generator, `gen-ucd-table.py`, if it is offered at all) and drop
   `tools/`. The `shape` dead-code attribute is independent and can be sent
   separately.

## Updating the base

Replace `src/`, `LICENSE`, `README.md`, `Cargo.lock` and `Cargo.toml` with the new release, reapply
the changes above (move the new `ucd_table.rs` to `ucd_table_upstream.rs` and run
`node vendor/harfrust/tools/split-ucd-table.mjs`), update the two `Cargo.lock` files that resolve the patch, and run the checks.
