import { vec3 } from 'three/tsl';
import type { bitmap } from '@pmndrs/glyph';
import {
  defineTextMaterial,
  type Glyphs,
  type Text,
  type TextGroup,
  type ThreeTextMaterial,
} from '@pmndrs/glyph/three';

const create: ThreeTextMaterial['create'] = (context) => {
  const material = context.createDefaultMaterial();
  material.positionNode = context.position.add(vec3(0, 2, 0));
  return material;
};

const plain: ThreeTextMaterial = defineTextMaterial(create);
plain.frustumCulled satisfies boolean;
plain.boundsPadding satisfies number;
defineTextMaterial(create, {});
defineTextMaterial(create, { boundsPadding: 2 });
defineTextMaterial(create, { frustumCulled: false });
defineTextMaterial(create, { frustumCulled: true, boundsPadding: 0.5 });

// @ts-expect-error The material's culling declaration is fixed when it is defined.
plain.boundsPadding = 4;
// @ts-expect-error Padding is a distance in the units of the context's `position`, not a per-axis vector.
defineTextMaterial(create, { boundsPadding: [1, 2, 0] });
// @ts-expect-error `frustumCulled` is Three's boolean, not a mode string.
defineTextMaterial(create, { frustumCulled: 'never' });
// @ts-expect-error Culling options are the two declared fields only.
defineTextMaterial(create, { bounds: 'unbounded' });
// @ts-expect-error A material is created by `defineTextMaterial`, which states its culling.
const literal: ThreeTextMaterial = { create };
void literal;

// Per-object opt-out is Three's own `Object3D.frustumCulled`; Glyph adds no second flag.
declare const text: Text<typeof bitmap>;
declare const group: TextGroup;
declare const glyphs: Glyphs;
text.frustumCulled = false;
group.frustumCulled = false;
glyphs.frustumCulled = false;
