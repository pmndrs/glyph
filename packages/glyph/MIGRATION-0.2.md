# Migrate from Glyph 0.1 to 0.2

Glyph 0.2 renames two methods without compatibility aliases and makes detached `Glyphs` indices consistently describe
only drawable glyphs. Migrate those call sites before adopting the new outline API or batching behavior.

## Preview the archived renames

In a Glyph source checkout with its pinned workspace dependencies already installed, these package-owned commands
preview the fixture-tested archived AST migrations without writing:

```sh
mise exec -- pnpm scripts run glyph:read-glyphs:migrate
mise exec -- pnpm scripts run glyph:split:migrate
```

Review the preview, then append `-- --write` to the command you want to apply:

```sh
mise exec -- pnpm scripts run glyph:read-glyphs:migrate -- --write
mise exec -- pnpm scripts run glyph:split:migrate -- --write
```

The transforms follow typed Glyph method references and optional calls. Manually review structural wrappers, `any`
receivers, computed keys, destructuring, and persisted strings. After migrating, run the consumer's typecheck and tests,
then run both previews again; they should find no remaining typed call sites.

## Rename borrowed reads

Rename `withGlyphs` to `readGlyphs` across core, Three, and TypeGPU call sites:

```ts
// 0.1
const glyphId = text.withGlyphs((glyphs) => glyphs.glyphAt(0).glyphId);

// 0.2
const glyphId = text.readGlyphs((glyphs) => glyphs.glyphAt(0).glyphId);
```

The callback still runs synchronously and returns its result unchanged. Exceptions still propagate, and the borrowed
view still expires when the callback returns or throws. Keep `glyphs()` for an owned full-layout copy; do not turn a
selected borrowed read into a full per-glyph scan merely because the method name changed.

## Rename split and use detached indices

Rename Three's `breakApart()` to `split()`:

```ts
// 0.1
const [glyphs, decorations] = text.breakApart();

// 0.2
const [glyphs, decorations] = text.split();
```

The tuple is still synchronous and independently owned, the source `Text` stays live, and callers still own attachment,
visibility, transforms, and disposal. `split()` queries current desired layout, including before the first render or
after an edit. It does not publish the source or unrelated labels; the returned copies own their realized data.

In 0.2, every `Glyphs` index is dense over drawable records. Spaces and other blank layout glyphs remain in
`text.glyphs()` but are absent from the detached object, so `glyphs.count` can be smaller than
`text.glyphs().glyphCount`. Do not zip or reuse indices between those two collections. `DetachedGlyph.sourceIndex` is no
longer public. Use the detached object's own measurements to keep transforms aligned:

```ts
const [glyphs, decorations] = text.split();

for (let index = 0; index < glyphs.count; index += 1) {
  const glyph = glyphs.glyphAt(index);
  const matrix = glyphs.measurements[index]!.originalMatrix.clone();

  matrix.elements[13] += Math.sin(index * 0.5) * glyph.fontSize * 0.1;
  glyphs.setMatrixAt(index, matrix);

  const outlineCacheKey = `${glyph.fontHandle}:${glyph.glyphId}`;
  // Equal keys describe the same shape; `glyph.key` still identifies the occurrence across reflow.
  void outlineCacheKey;
}

glyphs.dispose();
decorations?.dispose();
```

`fontHandle` is a non-owning plain number and `glyphId` is the glyph index in that font. Equal pairs identify an equal
outline. `glyphAt`, `outlineAt`, and the local/world matrix methods throw `RangeError` for non-integer or out-of-range
indices instead of returning a partial result.

## Opt in to glyph outlines

Bake with `glyph bake --outlines` to retain outlines for any raster format. The three read paths have different ownership:

- `text.readGlyphs((glyphs) => glyphs.outlineAt(index, target?))` returns typed-array views valid only inside the
  callback. Copy the arrays before retaining them.
- `text.glyphs().outlineAt(index)` returns owned contours indexed by the complete layout, including blank glyphs.
- `glyphs.outlineAt(index)` on the object returned by `split()` returns owned contours at the same dense drawable index
  used by `glyphAt`, `measurements`, and the matrix methods.

Outlines use em units with y down and the pen position as their origin. A detached matrix uses Three's y-up local space,
so scale outline coordinates by `glyph.fontSize`, negate y, and place them through that glyph's matrix.

Glyph 0.2 supports the static TrueType and CFF outline sources accepted by the baker. Outline-format metadata, CFF2, and
variable-font axes are deferred; 0.2 does not ship that support. Consume the named 0.2 fields and tolerate future extra
metadata rather than inventing a `format` discriminator.

## Choose batching and visibility deliberately

Top-level `TextGroup`s now use an automatic batch boundary. Keep the default `batching: 'auto'` when independently
hiding a group should skip its owned draws. Use `batching: 'shared'` to retain 0.1-style cross-group coalescing, or
`batching: 'group'` to force a nested boundary.

Frustum culling is on by default for every built-in draw: each draw is culled by a bound computed from the records it
draws. Set `frustumCulled = false` on a `Text`, an enclosing `TextGroup` or a `Glyphs` to submit every draw, and give a
custom material that moves glyphs `boundsPadding` (see `defineTextMaterial`). Hiding a group with `group.visible`
still skips its owned draws under `batching: 'auto'`.

Equivalent `Text.set()` state is now a no-op. Assign `font` or `material` explicitly when the application needs resource
restaging. A renderer-side failure keeps the last accepted draw state and is not retried by unchanged traversals; after
repairing the cause, assign material or other renderer-relevant state to request a new checkpoint.

## Check fixed-height text against the new overflow rule

`layout.overflow` applies when text does not fit a fixed `height` (in the last column with `columns`, or the last
region of a `flow`). Lines are judged by their line box, not their ink: a line that ends at or above the box's block
end fits, a line that starts inside the box and ends past it straddles the edge, and a line that starts at or below
the block end is outside.

| mode                  | 0.1.0 laid out and drew                                            | 0.2 lays out and draws                 |
| --------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| `'visible'` (default) | lines that fit                                                     | lines that fit and the straddling line |
| `'clip'`              | drew lines that fit; layout reads reported every line past the box | lines that fit                         |
| `'ellipsis'`          | lines that fit, the last ending in an ellipsis                     | unchanged                              |

So a default paragraph with a fixed height now shows one more line, spilling over the box's edge, whenever its text
does not fit. Use `overflow: 'clip'` to keep 0.1.0's drawing. If you read `measure().lines` or `glyphs()` of a
`'clip'` paragraph to find the text past the box, measure it with an unconstrained `height` instead; no mode lays out
lines wholly outside the box. `measure().overflowed` and `contentHeight` are unchanged. With an `at-most` height, the measured `height` follows the lines laid out: it can grow under `'visible'` (the straddling line, capped at the limit) and shrink under `'clip'` (no longer capped by lines past the box). Integrations that read
`primitive.clip` or a draw's `clip` now always see `undefined`: no overflow mode draws outside its box, so nothing needs
a clip boundary.

## Remove options that never did anything

Three `Text` properties, R3F and Vue `Text` props no longer accept `order`: it was typed but never read, and Three
paints in scene order with `renderOrder`. `glyph bake` no longer accepts `--yes`: the CLI never prompts. Delete both.
`glyph bake --check` against a missing output now fails with `STALE_OUTPUT` instead of a Node `ENOENT` stack.

## Bind a sampler with the TypeGPU Bitmap page

Only hosts that compose `@pmndrs/glyph/shaders/typegpu` themselves and bind `TypeGpuBitmapPageLayout` are affected;
`@pmndrs/glyph/typegpu` and `@pmndrs/glyph/three/typegpu` need no change. The canonical Bitmap fragment now samples its
page with filtering, as `/three` always has, instead of loading the nearest texel, so the layout carries the sampler:

```ts
// 0.1.0
root.createBindGroup(TypeGpuBitmapPageLayout, { page });

// 0.2.0
const sampler = root.createSampler({ magFilter: 'linear', minFilter: 'linear' });
root.createBindGroup(TypeGpuBitmapPageLayout, { page, sampler });
```

A host that replaces `bitmapCoverageSlot` owns its own read and changes nothing.

The sampler is the host's choice of filter: bind `root.createSampler({ magFilter: 'nearest', minFilter: 'nearest' })`
to read the nearest texel of a pixel-art strike, as the integrations do under `bitmapFilter: 'nearest'`. The WGSL is the
same either way. The integrations take that choice per handle, through `defineThreeConfig`, `defineTypeGpuConfig` or
`definePixi3DConfig({ bitmapFilter: 'nearest' })`; `'linear'` is the default and the 0.1.0 `/three` read.

## Rebake every font, and ask for the OpenType features your text uses

Every bake, with or without `--unicodes`, now keeps the common OpenType layout features: what shaping applies by
default (`liga`, `kern`, `calt`, `ccmp`, `locl`, `mark`, ...), `frac`/`numr`/`dnom`, and the vertical, direction and
complex-script features. Discretionary features such as `smcp`, `c2sc`, `onum`, `lnum`, `tnum`, `pnum`, `zero`,
`ssXX`, `cvXX`, `salt`, `swsh`, `dlig` and `case` are dropped unless the bake asks for them. In 0.1.0 a full bake kept
every feature and a `--unicodes` bake silently dropped them, so style `features` naming them did nothing on a subset.

Text whose style or span style enables a feature the bake dropped now throws `GlyphInputError` when the text is created
or updated:

```text
feature 'smcp' was not baked into Inter; bake with --layout-features smcp (layoutFeatures: ['smcp'])
```

Add the features your text enables, remove defaults you do not want, or keep everything:

```sh
glyph bake --input Inter-Regular.ttf --output inter-latin.font.glb --unicodes U+0020-007E --layout-features tnum,zero --msdf
glyph bake --input Inter-Regular.ttf --output inter.font.glb --layout-features '*,-ss01' --msdf
glyph bake --input Inter-Regular.ttf --output inter.font.glb --layout-features -liga --msdf
```

`--layout-features` (`layoutFeatures` in `bakeFont()` and a runtime-baked `loadFont` request) takes comma-separated
tokens: `*` (first only) starts from every feature, `tag` or `+tag` adds, `-tag` removes. Features script shaping needs
(`ccmp`, `locl`, `rvrn`, `mark`, `mkmk`, `curs`, `rlig`, `rclt`, the direction and complex-script features) cannot be
removed. A tag the font never had is ignored and listed in the bake report, and `{ tag, value: 0 }` never throws.
Fonts baked before this change carry no record of dropped features and never throw. Rebaked fonts are smaller where
they used to carry alternates no text asked for. A full bake of a face too large for the subsetter to prepare (Noto Sans CJK) keeps every feature
and reports a `LAYOUT_FEATURES_KEPT` warning. Every bake also keeps the font's `.notdef` glyph, so a `--unicodes` subset draws
the font's box for a missing character (it drew nothing) and grows by that glyph's rasters.

## Read glyph facts after `measure()` deliberately

`measure()` returns the same `ParagraphLayoutSummary` fields as before. A read that only needs the paragraph's box,
lines and baselines no longer positions glyphs: `glyphCount`, `missingGlyphCount`, `inkBounds` and each line's
`glyphStart`, `glyphCount` and `inkBounds` are computed the first time you read one of them. They describe the text as
it was when `measure()` returned, even if you edit it before reading them. Reading them right after `measure()` can cost
a second engine call the first time; once a text's caller reads them, its next `measure()` answers them in the same call,
and a short single-line label always does. Read only the fields you use in hot paths such as a resize loop.

## Verify the migration

At minimum, verify:

- callback return inference, exception propagation, and borrowed-view lifetime for `readGlyphs`;
- first-render and edited-copy parity, tuple ownership, source independence, and disposal for `split`;
- blank-containing text, detached counts, detached measurement alignment, and `RangeError` handling;
- the intended draw count and manual visibility behavior for each `TextGroup` batching mode;
- outline absence errors and outline placement if the application uses `--outlines`.
