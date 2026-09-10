import { glyph } from '@pmndrs/glyph';
import { GlyphProvider, Text, TextGroup } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { ThreeConfig, defineTextMaterial } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { use, useState } from 'react';
import { color as tslColor } from 'three/tsl';

import { Caption } from '../../components/text';
import { INTER } from '../../fonts';
import { plannedDraws } from '../../lib/planned-draws';
import { PAPER } from '../../theme';

/**
 * The same thirty labels twice, in a `TextGroup` each. Left, the two
 * materials interleave, so the plan must break a draw at every material
 * change and ends up with one per label. Right, the same labels sorted so
 * each material is one contiguous run, and the plan folds them into one draw
 * per material. Nothing else differs: batching is about what sits next to
 * what. The groups live on two named roots so each side's draws can be
 * counted under its own draw object.
 */
const COLUMNS = 5;
const COUNT = COLUMNS * 6;

const tint = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind === 'glyph') material.colorNode = tslColor('#70d6ff').mul(context.shader.opacity);
  return material;
});

/** A handle needs the engine, so it waits on `glyph.init()`; the component suspends on this like on a font. */
const handleReady = glyph.init().then(() => glyph.handle('examples:batching', ThreeConfig));

const tinted = (index: number): boolean => index % 2 === 1;
const INTERLEAVED = Array.from({ length: COUNT }, (_, index) => index);
const SORTED = [...INTERLEAVED].sort((a, b) => Number(tinted(a)) - Number(tinted(b)));

export default function Batching() {
  const handle = use(handleReady);
  const [draws, setDraws] = useState({ interleaved: 0, sorted: 0 });

  useFrame(({ scene }) => {
    const interleaved = plannedDraws(scene, 'interleaved');
    const sorted = plannedDraws(scene, 'sorted');
    if (interleaved !== draws.interleaved || sorted !== draws.sorted) setDraws({ interleaved, sorted });
  });

  return (
    <>
      <group position={[-5.1, 0, 0]}>
        <GlyphProvider handle={handle('interleaved')}>
          <Field order={INTERLEAVED} />
        </GlyphProvider>
      </group>
      <group position={[0.6, 0, 0]}>
        <GlyphProvider handle={handle('sorted')}>
          <Field order={SORTED} />
        </GlyphProvider>
      </group>
      <Caption x={-5.1} y={-1.6} width={4.5}>{`interleaved materials: ${draws.interleaved} draws`}</Caption>
      <Caption x={0.6} y={-1.6} width={4.5}>{`one run per material: ${draws.sorted} draws`}</Caption>
    </>
  );
}

/** Thirty labels in one group, laid out by slot; `order` decides which label fills which slot. */
function Field({ order }: { readonly order: readonly number[] }) {
  const inter = useMsdf(INTER);
  return (
    <TextGroup>
      {order.map((index, slot) => (
        <Text
          key={index}
          font={inter}
          {...(tinted(index) ? { material: tint } : {})}
          style={{ fontSize: 0.34, color: PAPER }}
          layout={{ align: 'center', wrap: 'none' }}
          constraints={{ width: { mode: 'exact', size: 0.9 } }}
          position={[(slot % COLUMNS) * 0.9, 2.4 - Math.floor(slot / COLUMNS) * 0.62, 0]}
        >
          {String(index + 1).padStart(2, '0')}
        </Text>
      ))}
    </TextGroup>
  );
}
