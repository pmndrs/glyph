import { Text, useMsdf } from '@pmndrs/glyph/react';
import { defineTextMaterial, type ThreeTextMaterialContext } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import { color, mix, step } from 'three/tsl';
import type { Group, Node } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ACCENT, PAPER_DIM } from '../../theme';

/**
 * The two position nodes a material context carries, used for the same
 * thing: colour bands one line tall, from the y coordinate. Both paragraphs
 * bob and tilt identically. `paragraphPosition` is the paragraph's own
 * space, so its bands are the lines themselves: each line keeps one colour
 * wherever the text goes. `position` is the final draw-local position, which
 * in the default indexed transform mode already includes the Text's
 * transform, so its bands stay level and still while the text moves through
 * them.
 */
const FONT_SIZE = 0.44;
const LINE_HEIGHT = 1.3;
/** Two lines: one of each colour. */
const PERIOD = FONT_SIZE * LINE_HEIGHT * 2;

const striped = (pick: (context: ThreeTextMaterialContext) => Node<'vec3'>) =>
  defineTextMaterial((context) => {
    const material = context.createDefaultMaterial();
    const band = step(0.5, pick(context).y.div(PERIOD).fract());
    material.colorNode = mix(color('#70d6ff'), color(ACCENT), band);
    return material;
  });

const byParagraph = striped((context) => context.paragraphPosition);
const byDraw = striped((context) => context.position);

const PASSAGE = 'Bands from a position node show which space the node is in.';

export default function MaterialPositions() {
  const inter = useMsdf(INTER);
  const movers = useRef<(Group | null)[]>([]);

  useFrame(({ elapsed }) => {
    for (const node of movers.current) {
      if (!node) continue;
      node.position.y = Math.sin(elapsed * 0.9) * 0.3;
      node.rotation.z = Math.sin(elapsed * 0.6) * 0.2;
    }
  });

  return (
    <>
      {(
        [
          [-5, byParagraph, 'context.paragraphPosition', 'each line keeps its color'],
          [0.6, byDraw, 'context.position', 'bands stay level as the text moves'],
        ] as const
      ).map(([x, material, name, note], index) => (
        <group key={name} position={[x, 0, 0]}>
          <Text
            font={inter}
            style={{ fontSize: 0.24, color: ACCENT }}
            layout={{ align: 'center', wrap: 'none' }}
            constraints={{ width: { mode: 'exact', size: 4.4 } }}
            position={[0, 2.5, 0]}
          >
            {name}
          </Text>
          {/* The Text sits at the centre of its mover so the tilt turns it about its middle. */}
          <group position={[2.2, 0.2, 0]}>
            <group ref={(node) => void (movers.current[index] = node)}>
              <Text
                font={inter}
                material={material}
                style={{ fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT }}
                layout={{ wrap: 'word', align: 'center' }}
                constraints={{ width: { mode: 'exact', size: 3.6 }, anchor: { x: 'center', y: 'middle' } }}
              >
                {PASSAGE}
              </Text>
            </group>
          </group>
          <Text
            font={inter}
            style={{ fontSize: 0.2, color: PAPER_DIM, letterSpacing: 0.02 }}
            layout={{ align: 'center', wrap: 'none' }}
            constraints={{ width: { mode: 'exact', size: 4.4 } }}
            position={[0, -2.2, 0]}
          >
            {note}
          </Text>
        </group>
      ))}
    </>
  );
}
