# Text split migration

Run the archived runner with this recipe, your consumer tsconfig, and your consumer root. Preview without `--write` first.
Within this repository, `mise exec -- pnpm scripts run glyph:split:migrate` previews changes; append `-- --write` to apply.

```ts
// Before
const [glyphs, decorations] = text.breakApart();
// After
const [glyphs, decorations] = text.split();
```

This is a method rename with no deprecated alias. It still requires committed renderer state and returns the frozen tuple
`[Glyphs, Decorations | undefined]` synchronously. Both returned objects are independent copies; the source remains live
and unchanged. Preserve caller-owned attachment, visibility, per-glyph transforms, and disposal. The method does not
accept a separator or offset and does not create child text objects. Existing failure and cleanup behavior remains.

The transform follows Glyph method symbols in repository source. For installed consumers, it handles typed property
accesses, method references, and optional calls against either old or new declarations without modifying dependencies.
Unrelated methods and string literals remain unchanged. Repository declaration renames update comment tokens.

Inspect residual `breakApart` identifiers and strings using AST queries and `rg`. Structural interfaces, `any` receivers,
computed string keys, destructuring against installed declarations, and custom wrappers may need manual migration.
Rename only actual Glyph operations; preserve protocol strings, historical records, and unrelated APIs. Update diagnostic
messages and test descriptions deliberately. The repository's detached-render proof has a structural interface that must
be migrated alongside its call.

Verify the tuple type, source independence, transform alignment, decoration ownership, committed-state errors, and disposal
through the existing integration and browser tests. Run the consumer typecheck. A second dry-run must report no changes.
