import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import type { Font } from '@pmndrs/glyph';
import type { msdf } from '@pmndrs/glyph/raster/msdf';
import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { type Group } from 'three/webgpu';

import { INTER } from '../../fonts';
import { useSceneInputs } from '../../lib/inputs';
import {
  CARD_DEPTH,
  CARD_FACES,
  CARD_HEIGHT,
  CARD_RADIUS,
  CARD_SEGMENTS,
  CARD_TEXT_Z,
  CARD_WIDTH,
  BOTTOM_Z,
  CORNER_X,
  CORNER_Y,
  TILT_DAMPING,
  TILT_X,
  TILT_Y,
  TOP_Z,
  type CardFace,
  type CardTransform,
  createCycleState,
  damp,
  queueFlip,
  stepCycle,
  writeCardTransform,
} from './config';
import { createPaperMaterial, foilInk } from './materials';

const CARD_SLOTS = [0, 1] as const;
const EMPTY_TRANSFORM: CardTransform = { x: 0, y: 0, z: 0, rotationY: 0 };

/**
 * Two physical cards, not a pool: whichever card is top turns twice about its
 * vertical axis, exposes its authored reverse halfway through, and lands
 * behind the other card. Text and pips are retained Glyph paragraphs, so a
 * click changes only transforms; it never reshapes or rebuilds the scene.
 */
export default function CardCycle() {
  const inter = useMsdf(INTER);
  const inputs = useSceneInputs();
  const tilt = useRef<Group>(null);
  const cards = useRef<(Group | null)[]>([null, null]);
  const cycle = useRef(createCycleState());
  const motion = useRef({ targetX: 0, targetY: 0, x: 0, y: 0 });
  const transforms = useRef<CardTransform[]>([{ ...EMPTY_TRANSFORM }, { ...EMPTY_TRANSFORM }]);
  const geometry = useMemo(
    () => new RoundedBoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_DEPTH, CARD_SEGMENTS, CARD_RADIUS),
    [],
  );
  const paper = useMemo(() => createPaperMaterial(), []);

  useEffect(
    () => () => {
      geometry.dispose();
      paper.dispose();
    },
    [geometry, paper],
  );

  useFrame(({ size }, delta) => {
    const inputBatch = inputs?.drain();
    if (inputBatch !== undefined) {
      for (const input of inputBatch) {
        if (
          input.x !== undefined &&
          input.y !== undefined &&
          (input.type === 'pointermove' || input.type === 'pointerdown')
        ) {
          motion.current.targetY = (input.x / Math.max(size.width, 1) - 0.5) * TILT_Y;
          motion.current.targetX = -(input.y / Math.max(size.height, 1) - 0.5) * TILT_X;
        }
        if (input.type === 'pointerdown') queueFlip(cycle.current);
        if (input.type === 'pointerleave' || input.type === 'pointercancel') {
          motion.current.targetX = 0;
          motion.current.targetY = 0;
        }
      }
    }

    motion.current.x = damp(motion.current.x, motion.current.targetX, TILT_DAMPING, delta);
    motion.current.y = damp(motion.current.y, motion.current.targetY, TILT_DAMPING, delta);
    tilt.current?.rotation.set(motion.current.x, motion.current.y, 0);

    stepCycle(cycle.current, delta);
    const progress = cycle.current.flipping ? cycle.current.progress : undefined;
    for (const slot of CARD_SLOTS) {
      const transform = transforms.current[slot];
      const card = cards.current[slot];
      if (transform === undefined || card === null || card === undefined) continue;
      writeCardTransform(transform, slot, cycle.current.top, progress);
      card.position.set(transform.x, transform.y, transform.z);
      card.rotation.set(0, transform.rotationY, 0);
    }
  });

  return (
    <>
      <ambientLight color="#f5f0e8" intensity={0.72} />
      <directionalLight color="#fff8ec" intensity={3.2} position={[3.5, 4.5, 5]} />
      <directionalLight color="#9eb8e9" intensity={1.2} position={[-4, 1, 3]} />
      <pointLight color="#d9a7b5" intensity={7} distance={7} decay={2} position={[0, -2.6, 2.6]} />
      <group ref={tilt} position={[0, -0.02, 0]}>
        {CARD_SLOTS.map((slot) => {
          const face = CARD_FACES[slot];
          if (face === undefined) return null;
          return (
            <group
              key={face.rank}
              position={[0, 0, slot === 0 ? TOP_Z : BOTTOM_Z]}
              ref={(group: Group | null) => {
                cards.current[slot] = group;
              }}
            >
              <mesh geometry={geometry} material={paper} castShadow receiveShadow />
              <PrintedFace font={inter} face={face} />
              <PrintedFace font={inter} face={face} back />
            </group>
          );
        })}
      </group>
    </>
  );
}

function PrintedFace({
  back = false,
  face,
  font,
}: {
  readonly back?: boolean;
  readonly face: CardFace;
  readonly font: Font<typeof msdf>;
}) {
  const direction = back ? Math.PI : 0;
  return (
    <group rotation={[0, direction, 0]}>
      <group position={[0, 0, CARD_TEXT_Z]}>
        {back ? <CardBack font={font} ink={face.ink} /> : <CardFront font={font} face={face} />}
      </group>
    </group>
  );
}

function CardFront({ face, font }: { readonly face: CardFace; readonly font: Font<typeof msdf> }) {
  return (
    <>
      <Corner font={font} rank={face.rank} suit={face.suit} color={face.ink} />
      <Corner font={font} rank={face.rank} suit={face.suit} color={face.ink} inverted />
      <Text
        font={font}
        material={foilInk}
        style={{ color: face.ink, fontSize: 0.18, letterSpacing: 0.12 }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 2.4 } }}
        position={[-1.2, 1.22, 0]}
      >
        {face.suit}
      </Text>
      {face.pips.map((pip, index) => (
        <group key={`${pip.x}:${pip.y}`} position={[pip.x, pip.y, 0]} rotation={[0, 0, pip.inverted ? Math.PI : 0]}>
          <Text
            font={font}
            material={foilInk}
            style={{ color: face.ink, fontSize: index === 2 ? 1.04 : 0.76 }}
            layout={{ align: 'center', wrap: 'none' }}
            constraints={{ width: { mode: 'exact', size: 1.1 } }}
            position={[-0.55, 0.28, 0]}
          >
            *
          </Text>
        </group>
      ))}
    </>
  );
}

function Corner({
  color,
  font,
  inverted = false,
  rank,
  suit,
}: {
  readonly color: string;
  readonly font: Font<typeof msdf>;
  readonly inverted?: boolean;
  readonly rank: CardFace['rank'];
  readonly suit: CardFace['suit'];
}) {
  return (
    <group
      position={[inverted ? CORNER_X : -CORNER_X, inverted ? -CORNER_Y : CORNER_Y, 0]}
      rotation={[0, 0, inverted ? Math.PI : 0]}
    >
      <Text
        font={font}
        material={foilInk}
        style={{ color, fontSize: 0.48, lineHeight: 0.85 }}
        layout={{ wrap: 'none' }}
        position={[0, 0.18, 0]}
      >
        {rank}
      </Text>
      <Text
        font={font}
        material={foilInk}
        style={{ color, fontSize: 0.14, letterSpacing: 0.07 }}
        layout={{ wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 0.76 } }}
        position={[0, -0.25, 0]}
      >
        {suit}
      </Text>
    </group>
  );
}

function CardBack({ font, ink }: { readonly font: Font<typeof msdf>; readonly ink: string }) {
  return (
    <>
      <Text
        font={font}
        material={foilInk}
        style={{ color: ink, fontSize: 0.16, letterSpacing: 0.18 }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 2.7 } }}
        position={[-1.35, 1.5, 0]}
      >
        GLYPH
      </Text>
      <Text
        font={font}
        material={foilInk}
        style={{ color: ink, fontSize: 0.88, letterSpacing: 0.03 }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 2.8 } }}
        position={[-1.4, 0.28, 0]}
      >
        * * *
      </Text>
      <Text
        font={font}
        material={foilInk}
        style={{ color: '#6a5c4b', fontSize: 0.15, letterSpacing: 0.11 }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 2.7 } }}
        position={[-1.35, -1.35, 0]}
      >
        CARD CYCLE
      </Text>
    </>
  );
}
