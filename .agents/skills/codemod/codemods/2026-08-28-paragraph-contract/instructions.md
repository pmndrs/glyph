# Reusable paragraph contract migration

Authored paragraph state has three reusable objects: `style: TextStyle`, `layout: ParagraphLayout`, and
`constraints: Constraints`. `TextStyle` includes typography plus color, opacity, outline, and shadow. Core still tracks
paint-only invalidation separately; consumers no longer express that implementation split.

Renderer-free `Paragraph` keeps constraints per query so retained layout hosts can probe multiple boxes without
changing authored state:

```ts
const paragraph = await createParagraph({ font, text, style, layout });
const metrics = paragraph.measure(constraints);
const glyphs = paragraph.glyphs(constraints);
paragraph.update({ style, layout });
```

Renderer-owned retained text, Three `Text`, and React `<Text>` store the resolved render constraints:

```ts
const text = planner.createText({ font, text: 'Hello', style, layout, constraints });
const object = new Text({ font, text: 'Hello', style, layout, constraints });
const element = <Text font={font} style={style} layout={layout} constraints={constraints}>Hello</Text>;
```

Split every old `contentBox` by meaning. Move `width` and `height` into `constraints`; move alignment, wrapping,
overflow, line limits, justification, indents, spacing, and columns into `layout`. Rename root `policy` to `layout`.
Merge every old `paint` object into `style`; when both are present, preserve the old cascade by applying `paint` after
the existing style fields. Nested React text may use `style`, but never `layout` or `constraints`.

`ParagraphLayout` formerly named positioned glyph columns. Those result types are now `GlyphLayout` and
`GlyphLayoutInspection`; wire values and persisted strings are unchanged. When a file imports both old
`ParagraphLayout` and `ParagraphLayoutPolicy`, the transform can distinguish and rename both. An output-only
`ParagraphLayout` import is ambiguous after migration and must be renamed to `GlyphLayout` by inspecting its use.
A reusable object typed as the removed
`ParagraphContentBox` cannot be split mechanically: create one `ParagraphLayout` and one `Constraints` object, then
pass both at each call site.

JavaScript call sites have no reliable owner type for `.layout()` or generic object properties named `paint` and
`contentBox`. Inspect those call sites and apply the same migration deliberately; the mechanical transform leaves them
unchanged rather than rewriting unrelated application APIs.

UIKit/Yoga adapters must keep `layout` stable while passing each candidate `constraints` to `paragraph.measure()`, then
pass the resolved content-box constraints to `paragraph.glyphs()`. Undefined Yoga axes still map to unconstrained and
point-scale rounding remains host-owned.

Verify no TypeScript or TSX source still imports or names `ParagraphContentBox`, `ParagraphStyle`,
`ParagraphLayoutPolicy`, `ParagraphConstraints`, `GlyphPaintInput`, an authored `paint` property, or a measurement call
through the old `layout()` method. Do not rewrite
historical prose, JSON fixture field names, render-plan paint palettes, or persisted protocol values merely because they
contain one of those words.
