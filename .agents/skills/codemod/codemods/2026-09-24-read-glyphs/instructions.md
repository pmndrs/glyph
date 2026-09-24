# Read glyphs migration

Use the archived runner with this recipe, your consumer tsconfig, and your consumer root. Run without `--write` first.
Within this repository, `mise exec -- pnpm scripts run glyph:read-glyphs:migrate` previews changes; append `-- --write`
to apply them. The recipe project includes Glyph source, its type and Three integration tests, and the package benchmark.

```ts
// Before
const id = text.withGlyphs((view) => view.glyphAt(0).glyphId);
// After
const id = text.readGlyphs((view) => view.glyphAt(0).glyphId);
```

The callback still runs once synchronously and returns its result unchanged. Exceptions propagate, the indexed view
expires on callback exit, and asynchronous callbacks, engine reentry, and retained-text mutation remain invalid.
The callback may inspect selected indices; do not rewrite it as per-glyph iteration. `glyphs()` still returns an owned
full inspection. No deprecated alias is retained in the package.

In repository source, the transform follows Glyph method symbols and their typed references. For installed consumers,
it migrates typed property accesses, method references, and optional calls against old or new Glyph declarations without
modifying dependencies.
Unrelated methods and string literals are preserved. Comments follow repository declaration renames through the runner's
comment scanner.

Inspect remaining `withGlyphs` and `_withGlyphs` uses with AST queries and `rg`. Computed string keys, destructuring against
installed-package declarations, `any` receivers, dynamic imports without types, and custom wrappers may need manual edits.
Rename only actual Glyph access or forwarding methods; preserve protocol strings, persisted data, historical records,
and unrelated APIs. Update test descriptions and current documentation deliberately after code migration.

The package benchmark intentionally retains a compatibility adapter for older installed canaries. It aliases the old
prototype method before timing, so both versions exercise the same borrowed-read operation without a timed branch.

Verify callback return-type inference, exception propagation, expired-view rejection, and selected-read equality with
owned inspections. Run the consumer's typecheck and behavioral tests. A second dry-run must report no changes.
