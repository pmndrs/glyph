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

For R3F, pass the already-created handle through `GlyphProvider`, or use the explicit `handle` prop on an outer `Text`
or `TextGroup`. The provider is dependency injection only and must not call `glyph.init()`, create a handle, or dispose an
externally owned handle. Nested `Text` elements remain inline semantic spans and do not select a handle independently.

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
behavior, and generated files separately. A successful migration proves that root initialization precedes handle
creation, every retained Three object has exactly one handle, provider changes reconstruct R3F objects, and disposal
settles each handle-owned domain once.
