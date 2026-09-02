import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useSlug } from '@pmndrs/glyph/react/slug';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import { color as tslColor } from 'three/tsl';

import { INTER, PLAYWRITE } from '../../fonts';
import { ACCENT, PAPER } from '../../stage';

/**
 * Runs inside one paragraph. Each nested Text overrides one thing — a color,
 * a font, a material — and inherits the rest. Nothing here is an offset:
 * the tree is the document, and the boundaries fall where the tree says.
 * The script face is the landing wordmark's subset, so its run spells the
 * one word it can: glyph.
 */
const tint = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind === 'glyph') material.colorNode = tslColor('#70d6ff').mul(context.shader.opacity);
  return material;
});

export default function RichText() {
  const inter = useMsdf(INTER);
  const script = useSlug(PLAYWRITE);

  return (
    <Text
      font={inter}
      style={{ fontSize: 0.42, color: PAPER, lineHeight: 1.35 }}
      layout={{ wrap: 'word', align: 'center' }}
      constraints={{ width: { mode: 'exact', size: 9 } }}
      position={[-4.5, 1.4, 0]}
    >
      A paragraph is one shaped unit, and a <Text style={{ color: ACCENT }}>span</Text> is a range inside it. It may
      change the font —{' '}
      <Text font={script} style={{ fontSize: 0.6 }}>
        glyph
      </Text>{' '}
      — the <Text style={{ letterSpacing: 0.08, features: [{ tag: 'smcp' }] }}>style</Text>, or the{' '}
      <Text material={tint}>material</Text> — and inherit everything it does not name.
    </Text>
  );
}
