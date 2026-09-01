# Migrate Three and R3F construction to Glyph handles

Initialize the process-local root before constructing a handle. Create each adapter handle once at application setup,
give it a stable diagnostic name, and keep disposal under the same owner that created it. A handle owns its adapter
configuration and shared bookkeeping; it does not own a Three renderer, scene, camera, canvas, or React root.

Replace imperative construction only after selecting the intended handle:

```ts
// Before
const text = new Text({ font, text: 'Hello' });
const group = new TextGroup();

// After
await glyph.init();
const three = glyph.handle('main-three', ThreeConfig);
const text = three.createText({ font, text: 'Hello' });
const group = three.createTextGroup();
```

Do not choose a handle from a font. Immutable root `Font` values may be bound independently by multiple handles. Keep
scene insertion unchanged: applications still call `scene.add(text)` or parent objects through normal Three APIs.

For ordinary R3F, remove per-object handle wiring. `<Text>` and `<TextGroup>` lazily initialize Glyph and use the built-in
Three config when no provider is present:

```tsx
<Canvas>
  <Text font={font}>Hello</Text>
</Canvas>
```

When a subtree needs a custom or independently configured handle, select it once at the shared ownership boundary:

```tsx
await glyph.init();
const three = glyph.handle('labels', ThreeConfig);

<GlyphProvider handle={three}>
  <TextGroup>
    <Text font={font}>Hello</Text>
  </TextGroup>
</GlyphProvider>;
```

Move an old `handle` prop on `Text` or `TextGroup` to the nearest boundary that owns all objects using that handle. If
siblings deliberately used different handles, wrap each subtree in its own provider. A provider captures its initial
handle and never updates its context value; remount it with a new `key` to select another handle and reconstruct the
subtree. The provider neither creates nor disposes its externally owned handle. Nested `Text` elements remain inline
semantic spans and never select a handle independently.

One `TextGroup` may contain only objects created by the same handle. Reconstruct an object when changing handles; do not
mutate a live object's ownership. Multiple handles may coexist in one scene, and one handle may create distinct objects
for multiple scenes.

Leave policy-named wire tags, persisted identities, generated ABI names, and current low-level `/core` identifiers
unchanged. This migration adopts the public `Codec` vocabulary at the new config boundary; it is not a global textual
replacement of internal protocol terms.

Residual inventory:

```bash
rg -n "new (Text|TextGroup)\\(" packages apps --glob '*.{ts,tsx,mts}'
rg -n "createElement\\((Text|TextGroup)" packages apps --glob '*.{ts,tsx,mts}'
```

After mechanical sites are gone, inspect factories, subclass constructors, tests that intentionally prove legacy
behavior, and generated files separately. A successful migration proves that root initialization precedes explicit
handle creation, every retained Three object has exactly one provider-or-default handle, provider selection is immutable
for one mount, provider remounts reconstruct R3F objects, and disposal settles each explicitly owned handle domain once.
