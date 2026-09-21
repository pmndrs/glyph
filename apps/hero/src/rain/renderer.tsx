import { Text, TextGroup } from '@pmndrs/glyph/react';
import type { slug } from '@pmndrs/glyph';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useEffect, useRef } from 'react';
import { Box3, type Group } from 'three/webgpu';
import type { SlugFont } from '../hero/fonts';
import { usePreparation } from '../hero/prepare';
import { solidOf } from '../letters/utils';
import { jitter } from '../utils';
import { rainActions } from './actions';
import { COUNT, GLYPHS, THICKNESS } from './content';
import { rainGlass, rainShade } from './materials';

const SLOTS = Array.from({ length: COUNT }, (_, index) => ({
  index,
  glyph: GLYPHS[Math.floor(jitter(index + 29) * GLYPHS.length)]!,
  material: rainGlass[index % rainGlass.length]!,
  shade: rainShade[index % rainShade.length]!,
}));
/** Both draws of a slot's glyph shape it the same way, so the shadow is the pane's own outline. */
const CELL = {
  constraints: { width: { mode: 'exact', size: 2 } },
  layout: { align: 'center', wrap: 'none' },
  position: [-1, 0.5, 0],
  style: { color: '#ffffff', fontSize: 1, lineHeight: 1 },
} as const;
const ink = new Box3();

/**
 * A pool of stained-glass glyphs, mounted hidden so every slot is shaped, cut into a solid, and compiled before
 * playback. Each glyph sits on its ink centre, which is where its body's origin is, and casts its shadow from a
 * second draw of the same glyph that its shader projects onto the floor, drawn before any pane.
 */
export function RainRenderer({ font }: { readonly font: SlugFont }) {
  const world = useWorld();
  const groups = useRef<(Group | null)[]>([]);
  const aligns = useRef<(Group | null)[]>([]);
  const texts = useRef<(ThreeText<typeof slug> | null)[]>([]);
  const shades = useRef<(ThreeText<typeof slug> | null)[]>([]);
  const prepared = useRef(new Uint8Array(COUNT));
  usePreparation('rain', () => prepared.current.every((flag) => flag === 1));

  useEffect(() => {
    rainActions(world).mountRainView(groups.current);

    return () => rainActions(world).unmountRainView();
  }, [world]);

  useFrame(
    () => {
      for (let slot = 0; slot < COUNT; slot++) {
        if (prepared.current[slot] === 1) continue;

        const text = texts.current[slot];
        const align = aligns.current[slot];

        if (text === null || text === undefined || align === null || align === undefined) continue;
        if (text.commitState().status !== 'committed') continue;
        if (shades.current[slot]?.commitState().status !== 'committed') continue;

        const layout = text.glyphs();
        const glyphId = layout.glyphIds[0];
        const fontSize = layout.glyphFontSizes[0];

        if (glyphId === undefined || fontSize === undefined) continue;

        ink.copy(text.computeBoundingBox());
        align.position.set(
          -text.position.x - (ink.min.x + ink.max.x) / 2,
          -text.position.y - (ink.min.y + ink.max.y) / 2,
          0,
        );
        rainActions(world).prepareRainGlyph(slot, solidOf(font, glyphId, fontSize, THICKNESS));
        prepared.current[slot] = 1;
      }
    },
    { id: 'rain-prepare' },
  );

  return (
    <TextGroup name="glyph-rain">
      {SLOTS.map(({ index, glyph, material, shade }) => (
        <group
          key={index}
          ref={(group) => {
            groups.current[index] = group;
          }}
          visible={false}
        >
          <group
            ref={(group) => {
              aligns.current[index] = group;
            }}
          >
            <group name="rain-shade" renderOrder={-1}>
              <Text
                {...CELL}
                font={font}
                material={shade}
                ref={(text) => {
                  shades.current[index] = text;
                }}
              >
                {glyph}
              </Text>
            </group>
            <Text
              {...CELL}
              font={font}
              material={material}
              ref={(text) => {
                texts.current[index] = text;
              }}
            >
              {glyph}
            </Text>
          </group>
        </group>
      ))}
    </TextGroup>
  );
}
