# Held rope stack: public declaration and export review

Scope: read-only TypeScript package declaration/export compatibility. No source edit, build, typecheck, test, benchmark, server, or runtime/ABI review was performed here.

## Frozen inputs

| Input                   | Identity                                                                                                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Held checkout           | `/private/tmp/glyph-held-20261016`, clean `ad6327d9199cedf88217f1098db3aeb439ec3e66`                                                                                                               |
| Held packed archive     | `/private/tmp/glyph-held-20261016/.cache/held-local-20261018/physical-byte-elision/package/pmndrs-glyph-0.1.0.tgz`, SHA-256 `880255c15c9822ded79cc934dba755070348faf729bc96af9cd6f450a57cb332`     |
| Current main control    | `/private/tmp/glyph-held-main-20261016`, `4e25a96a57462fef5ad0d19065a822695b480f60`                                                                                                                |
| Main packed archive     | `/private/tmp/glyph-held-20261016/.cache/held-local-20261016/main-baseline/pmndrs-glyph-0.1.0.tgz`, SHA-256 `bbb3375c08fb3db8186ec10e4b766b7170632f7601eb1ec0e90be0197f22eb20`                     |
| Published 0.1.0 archive | `/private/tmp/glyph-held-20261016/.cache/held-local-20261016/prepare-receipt/package/pmndrs-glyph-published-0.1.0.tgz`, SHA-256 `6e2bf7bdef50ec528a4e4799b8f067e81335388265fbb4950cbbcf08f840581b` |
| Package evidence        | `/private/tmp/glyph-held-20261016/.cache/held-local-20261018/physical-byte-elision/package/package-evidence-final.json`                                                                            |

I checked the three archive SHA-256s directly. The evidence receipt reports exact packaged-source correspondence and pre/post-pack `dist` identity. I spot-checked its member hashes for `dist/index.d.ts`, `layout.d.ts`, `text-properties.d.ts`, and `three/glyph-measurement.d.ts` against the held checkout; all four matched. The receipt reports equal `exports`, `types`, `typings`, peers, peer metadata, and side-effects fields across held, main, and published archives. It inventories 450 held declaration artifacts, 452 main, and 219 published; these totals include `.d.ts.map` files and are not public-symbol counts.

## Finding: main's later public anchor/typography API is absent from held

The held branch drops a reachable API introduced on current main by `60d1306a98b522bf23c2103b5bc0863b9fb681ea` (`feat(glyph): expose typographic references and box anchors (#308)`, 2026-10-15). That commit is an ancestor of the main control and is not an ancestor of the held commit. This is a **main integration requirement** for the frozen candidate, not a regression against published 0.1.0, whose declarations lack these types and fields. Do not infer that a released 0.1.0 caller is broken by this particular omission.

The precise public contractions are:

| Reachable surface    | Main signature / location                                                                                                                                                           | Held signature / location                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Root type exports    | `LayoutPoint`, `LineFontMetrics`, `TypographicReferences`, `TextAnchor`, `TextAnchorX`, `TextAnchorY` in `packages/glyph/src/index.ts:205-240` at main                              | Names absent from `packages/glyph/src/index.ts:205-243`                                             |
| Authored constraints | `Constraints { anchor?: TextAnchor; width?; height? }` in main `packages/glyph/src/text-properties.ts:55-60`                                                                        | `Constraints { width?; height? }` in held `packages/glyph/src/text-properties.ts:36-40`             |
| Measurement return   | `ParagraphMeasurement extends BaselineMetrics, TypographicReferences { fontMetrics: LineFontMetrics; anchorOffset: LayoutPoint; ... }` in main `packages/glyph/src/layout.ts:67-72` | `ParagraphMeasurement extends BaselineMetrics { ... }` in held `packages/glyph/src/layout.ts:33-54` |
| Per-line return      | `ParagraphLineMetrics extends BaselineMetrics, TypographicReferences { fontMetrics: LineFontMetrics; ... }` in main `packages/glyph/src/layout.ts:94-96`                            | `ParagraphLineMetrics extends BaselineMetrics { ... }` in held `packages/glyph/src/layout.ts:56-72` |

`Constraints` is a root export and flows into `/three` Text options, React/Vue props, and TypeGPU text options. `ParagraphMeasurement` is a root export and flows through public `measure()` returns; `ParagraphLineMetrics` flows through `ParagraphLayoutSummary.lines`. Consequently, a current-main consumer like this loses both an accepted input and observable output on held:

```ts
import type { Constraints, ParagraphLayoutSummary, TextAnchor } from '@pmndrs/glyph';

const anchor: TextAnchor = { x: 'center', y: 'cap-height-top' };
const constraints: Constraints = { anchor };
function place(summary: ParagraphLayoutSummary) {
  return summary.anchorOffset.x + summary.lines[0]!.fontMetrics.capHeight;
}
```

On held, `TextAnchor` has no root export; an inline `{ anchor: ... }` literal fails excess-property checking for `Constraints`; `anchorOffset` and `fontMetrics` are absent from the return types. The candidate's `dist/index.d.ts`, `layout.d.ts`, and `text-properties.d.ts` confirm the source change. Reconcile this main commit before treating the held branch as API-compatible with current main. This review leaves frozen code untouched while timing runs are active.

## Other changed declarations versus main

I inspected the receipt's 18 changed `.d.ts` member paths (excluding maps) and the relevant old/new text. The only changed **entry declaration file** is `dist/index.d.ts`; the other directly exported entry files, including `/core`, `/three`, `/react`, `/vue`, `/typegpu`, shader and baker entries, are byte-identical to main. Indirect public changes are the anchor/measurement types above. The `three/glyphs.d.ts` and `three/text.d.ts` differences are comments describing removal of anchor behavior, with no additional method/field signature changes. `three/glyph-measurement.d.ts` removes a third optional parameter from `measureGlyphPlacements`, but the function's module path `./three/glyph-measurement` is explicitly blocked by `exports`, and `/three` re-exports only `ThreeGlyphMeasurement`-related types from that module. Its public `ThreeGlyphMeasurement` shape changes only in documentation. The `three/command-buffer-renderer.d.ts` and `three/transform-synchronizer.d.ts` changes also sit behind null package subpaths and are not root/entry exports.

`typegpu/text.d.ts` emits `createText` again, but `/typegpu` re-exports only its `TypeGpu*` types; the raw module path is not exported. `formatted-text.d.ts` replaces internal span-ownership helpers while the root exports only `span`, `txt`, and selected text types. `engine-encoding.d.ts`, `generated/text-shaper-abi.d.ts`, new `config/text-span-owner.d.ts`, and changed `internal/*` members have no direct exported path or reachable changed public signature. `GlyphRootServices` has added `@internal` source methods, but its packed `config/glyph.d.ts` is byte-identical to main: the declaration emit excludes those methods. The removed `text-anchor.d.ts` and its `index.d.ts` references correspond to the main-only anchor finding, not a broken declaration import on held.

## Published 0.1.0 context

I compared the published archive's direct text entry declarations with the held copies for root, core, Three, Three/TypeGPU, TypeGPU, React, Vue, both shader entries, three raster bakers, baker, Node bake, and runtime bake. Only `index.d.ts`, `core.d.ts`, `three.d.ts`, and `node/bake.d.ts` differ at those direct entries: outlines, placement helpers, `TextGroupBatching`, and optional bake outlines are additions. The relevant published `layout.d.ts` and `text-properties.d.ts` have no anchor/typographic fields, matching held on the finding above.

The published-to-held closure does contain earlier, deliberate 0.2 source breaks already present on main: `GlyphTextController.withGlyphs` and Three `Text.withGlyphs` became `readGlyphs`; Three `Text.breakApart()` became `split()`; `DetachedGlyph.sourceIndex` and `ThreeGlyphMeasurement.sourceIndex` were removed as drawable indexing changed. Published `Glyphs.glyphAt()` returned `DetachedGlyph | undefined`, whereas held returns `DetachedGlyph` and documents an out-of-range throw. `packages/glyph/MIGRATION-0.2.md:27-75` and `CHANGELOG.md:5-22` document the renames and detached-index migration; the source-index change on `ThreeGlyphMeasurement` is visible in the declaration diff and should be considered by consumers of that public type. These are release migration differences, not new held-stack contractions. The held archive still has package version `0.1.0` because this is a pre-release pack; its changelog targets 0.2.0.

Other inspected published-to-held reachable declaration changes are additive or comments: optional `GlyphSchema.preservesHostTopology` and `retainedTopology`, optional font outline reports, `GlyphLayoutInspection.outlineAt`, `BorrowedGlyphLayout.outlineAt`, `GlyphPlacements.caretForOffset`, Three batching, and shader `coverageAt`. The TypeGPU bitmap shader import for `d` changes from `typegpu/data` to `typegpu`; that is an inherited main declaration change and its compatibility depends on the declared TypeGPU peer version, not on this held stack.

## Coverage and limits

- Read the worktree's `AGENTS.md`, engineering code style, and `engine-call-contract` skill. Checked package manifest reachability and explicit null subpaths rather than treating every emitted `.d.ts` as public.
- Used the frozen package receipt to identify every changed declaration member versus main, then inspected all 18 non-map changes and the exported reachability of changed symbols. Compared published direct entry declarations and the relevant changed transitive public types; did not mechanically prove bidirectional TypeScript assignability for every symbol in all 219 published declaration artifacts.
- No typechecker, package consumer test, runtime behavior test, build, benchmark, or ABI verification was run in this review. Existing separate peer/type checks were not rerun.
- The worktrees and packages were read only. Main-only advanced API should be reconciled in its integration branch; this report makes no source patch to the frozen held package.
