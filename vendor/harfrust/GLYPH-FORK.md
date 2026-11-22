# HarfRust fork carried by pmndrs/glyph

This directory is the published `harfrust` 0.12.0 crate with three cargo features, one constructor
and one inlining attribute added. It is wired into `packages/glyph/rust/shaper` and `packages/glyph/rust/font-baker`
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
`default-features = false` and turns all three off in the shipped shaper.

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

### Not part of the feature work

`src/hb/face.rs`: `shape` is allowed to be dead without `experimental_font_api`. Upstream has this
warning too; cargo hides it for registry dependencies and shows it for a path dependency.

## Checks

```sh
# the fork against the crates.io release, as glyph consumes it and as upstream would ship it
mise exec -- pnpm scripts run glyph:harfrust-fork-tests

# every feature combination builds with no warning
for features in libm libm,aat libm,rand libm,language-tags std std,aat std,rand std,language-tags std,aat,rand,language-tags,experimental_font_api; do
  cargo check --locked --manifest-path vendor/harfrust/Cargo.toml --no-default-features --features "$features"
done
```

The package test (`pnpm --filter @pmndrs/glyph test`) runs the first command. `vendor/harfrust-parity`
shapes its fixtures and the repository's shaping corpus through both crates and compares every
glyph ID, cluster, flag, advance and offset. Its fixtures have no AAT tables, so it does not
exercise `morx`, `kerx` or `trak` in either configuration; upstream's own test suite is not part of
the published crate and is not vendored.

## Cutting an upstream pull request

1. Check out upstream at the base commit and copy `src/` over `harfrust/src/`.
2. In `harfrust/Cargo.toml` add `aat = []`, `language-tags = []` and `rand = []` under `[features]`
   and add all three to `default`.
3. Drop this file. The `shape` dead-code attribute is independent and can be sent separately.

## Updating the base

Replace `src/`, `LICENSE`, `README.md`, `Cargo.lock` and `Cargo.toml` with the new release, reapply
the changes above, update the two `Cargo.lock` files that resolve the patch, and run the checks.
