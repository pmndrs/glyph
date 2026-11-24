# 0.2.0 package issues

Findings from the hero (`experiments/sil-hero`) and docs-site (`experiments/sil-docs-site`) lanes, each reproduced
against the `experiments/segment-indexed-layout` package and recorded with its root cause and chosen fix. Severity:
**ship-blocker** for 0.2.0, **should-fix**, or **later**. Nothing here is filed on GitHub.

| id                                              | title                                                                     | severity     | status                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------- | ------------ | ------------------------------------------------ |
| [01](01-overflow-clip-pixels.md)                | `overflow: 'clip'` does not clip pixels in Three                          | should-fix   | fixed (`experiments/sil-overflow`)               |
| [02](02-subset-drops-discretionary-features.md) | A subset bake drops discretionary OpenType features                       | ship-blocker | fix ready; held on asset-size decision           |
| [03](03-cff-unicode-subset.md)                  | `glyph bake --unicodes` loses the outlines of every CFF font              | ship-blocker | fixed                                            |
| [04](04-pixi3d-input-errors.md)                 | `Pixi3DText` throws `TypeError`/`RangeError` instead of `GlyphInputError` | should-fix   | fixed                                            |
| [05](05-react-disposed-font-resource.md)        | React can hand a disposed font resource to a mounting component           | should-fix   | not reproduced; planned                          |
| [06](06-three-order-unread.md)                  | `order` on Three text properties is typed but never read                  | should-fix   | fixed                                            |
| [07](07-on-invalidate-material-groups.md)       | `root.onInvalidate` misses `root.material` and `TextGroup` changes        | should-fix   | fixed                                            |
| [08](08-drop-cap-layout-export.md)              | `DropCapLayout` is not exported from the root entry                       | should-fix   | fixed                                            |
| [09](09-coverage-at-rename-warnings.md)         | A second `shader.coverageAt` call floods renamed-declaration warnings     | should-fix   | fixed                                            |
| [10](10-bake-check-missing-output.md)           | `glyph bake --check` raw ENOENT; `--yes` unused                           | should-fix   | fixed                                            |
| [11](11-r3f-text-ref-first-effect.md)           | R3F `<Text ref>` is null in the consumer's first effect                   | should-fix   | fixed                                            |
| [12](12-release-docs-corrections.md)            | Release docs state removed or wrong behaviour                             | ship-blocker | fixed                                            |
| [13](13-per-glyph-material-identity.md)         | No per-glyph identity or per-instance input in materials                  | later        | approved: `glyphIndex` + glyph origin; not built |
| [14](14-split-cost-and-resync.md)               | `split()` cost and no re-sync after an edit                               | later        | decided: no re-sync API; cost work open          |
| [15](15-font-from-font-face.md)                 | No public `Font` from a `FontFace` outside the hooks                      | later        | planned (design)                                 |
| [16](16-overflow-visible-clip-inverted.md)      | `overflow: 'visible'` drops lines while `'clip'` lays them all out        | should-fix   | fixed (`experiments/sil-overflow`)               |
| [17](17-three-group-input-errors.md)            | Three `TextGroup` options and `Text.onLayout` throw raw errors            | later        | planned                                          |
