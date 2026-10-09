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
visibility, transforms, and disposal. `split()` still requires committed renderer state.

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

Visibility culling is manual in 0.2: set `group.visible` from the application's own bounds or camera test. Automatic
off-screen group culling is not shipped.

Equivalent `Text.set()` state is now a no-op. Assign `font` or `material` explicitly when the application needs resource
restaging. A renderer-side failure keeps the last accepted draw state and is not retried by unchanged traversals; after
repairing the cause, assign material or other renderer-relevant state to request a new checkpoint.

## Verify the migration

At minimum, verify:

- callback return inference, exception propagation, and borrowed-view lifetime for `readGlyphs`;
- committed-state errors, tuple ownership, source independence, and disposal for `split`;
- blank-containing text, detached counts, detached measurement alignment, and `RangeError` handling;
- the intended draw count and manual visibility behavior for each `TextGroup` batching mode;
- outline absence errors and outline placement if the application uses `--outlines`.
