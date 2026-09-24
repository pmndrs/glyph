import { Text, TextGroup } from '@pmndrs/glyph/react';
import type { slug } from '@pmndrs/glyph';
import type { Glyphs, Text as ThreeText, TextGroup as ThreeTextGroup } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useEffect, useRef } from 'react';
import { Box3, type Group } from 'three/webgpu';
import type { SlugFont } from '../loading/fonts';
import { usePreparation } from '../loading/prepare';
import { solidOf } from '../letters/utils';
import { jitter } from '../utils';
import { rainActions } from './actions';
import { COUNT, GLYPHS, THICKNESS } from './content';
import { rainGlass } from './materials';

const SLOTS = Array.from({ length: COUNT }, (_, index) => ({
  index,
  glyph: GLYPHS[Math.floor(jitter(index + 29) * GLYPHS.length)]!,
  material: rainGlass[index % rainGlass.length]!,
}));
const ink = new Box3();

/**
 * A pool of stained-glass glyphs, mounted hidden so every slot is shaped, cut into a solid, and compiled before
 * playback. Each glyph sits on its ink centre, which is where its body's origin is. Once shaped, each glyph is
 * broken apart into a plain mesh under its slot, as the title is, and the draws are published, so the glass
 * projection captures each glyph and casts its shadow and caustic.
 */
export function RainRenderer({ font }: { readonly font: SlugFont }) {
  const world = useWorld();
  const root = useRef<ThreeTextGroup>(null);
  const groups = useRef<(Group | null)[]>([]);
  const aligns = useRef<(Group | null)[]>([]);
  const texts = useRef<(ThreeText<typeof slug> | null)[]>([]);
  const copies = useRef<(Glyphs | undefined)[]>([]);
  const prepared = useRef(new Uint8Array(COUNT));
  const mounted = useRef(false);
  usePreparation('rain', () => mounted.current);

  useEffect(
    () => () => {
      if (mounted.current) rainActions(world).unmountRainView();

      mounted.current = false;
      prepared.current.fill(0);

      for (let slot = 0; slot < COUNT; slot++) {
        copies.current[slot]?.removeFromParent();
        copies.current[slot]?.dispose();
        copies.current[slot] = undefined;
        const text = texts.current[slot];

        if (text !== null && text !== undefined) text.visible = true;
      }
    },
    [world],
  );

  useFrame(
    () => {
      if (mounted.current) return;

      for (let slot = 0; slot < COUNT; slot++) {
        if (prepared.current[slot] === 1) continue;

        const text = texts.current[slot];
        const align = aligns.current[slot];

        if (text === null || text === undefined || align === null || align === undefined) continue;
        if (text.commitState().status !== 'committed') continue;

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
        // The glyph's own draws live at the scene root. A broken-apart copy under the slot is what the projection
        // finds and what is drawn from here on, and it moves with the slot.
        const [glyphs, decorations] = text.breakApart();
        decorations?.dispose();
        text.parent?.add(glyphs);
        text.visible = false;
        copies.current[slot] = glyphs;
        prepared.current[slot] = 1;
      }

      if (root.current !== null && prepared.current.every((flag) => flag === 1)) {
        rainActions(world).mountRainView({ root: root.current, groups: groups.current });
        mounted.current = true;
      }
    },
    { id: 'hero-rain-prepare' },
  );

  return (
    <TextGroup name="glyph-rain" ref={root}>
      {SLOTS.map(({ index, glyph, material }) => (
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
            <Text
              constraints={{ width: { mode: 'exact', size: 2 } }}
              font={font}
              layout={{ align: 'center', wrap: 'none' }}
              material={material}
              position={[-1, 0.5, 0]}
              ref={(text) => {
                texts.current[index] = text;
              }}
              style={{ color: '#ffffff', fontSize: 1, lineHeight: 1 }}
            >
              {glyph}
            </Text>
          </group>
        </group>
      ))}
    </TextGroup>
  );
}
