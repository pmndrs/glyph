import { glyph } from '@pmndrs/glyph';
import { GlyphProvider, Text, TextGroup, useMsdf } from '@pmndrs/glyph/react';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { use, useState, type ReactNode } from 'react';

import { INTER } from '../../fonts';
import { plannedDraws } from '../../lib/planned-draws';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';

/**
 * Three translucent words stacked on each other, twice, with the same
 * rotating `renderOrder` on each word. Left, the words are children of one
 * `TextGroup`: a child's `renderOrder` ranks its paragraph inside the shared
 * batch, so the stack reorders and stays one draw. Right, the words are
 * ungrouped: `renderOrder` is three's own, each distinct value is its own
 * draw, and three sorts them.
 */
const WORDS = [
  { text: 'one', color: ACCENT },
  { text: 'two', color: '#70d6ff' },
  { text: 'three', color: '#ff6b9d' },
] as const;

const count = (draws: number): string => `${draws} ${draws === 1 ? 'draw' : 'draws'}`;

const handleReady = glyph.init().then(() => glyph.handle('examples:scene-draw-order', ThreeConfig));

function Stack({ top }: { readonly top: number }) {
  const inter = useMsdf(INTER);
  return WORDS.map((word, index) => (
    <Text
      key={word.text}
      font={inter}
      // The word whose turn it is draws last, so it is on top.
      renderOrder={(index - top + WORDS.length - 1) % WORDS.length}
      style={{ fontSize: 1.5, color: word.color, opacity: 0.82, letterSpacing: -0.02 }}
      layout={{ wrap: 'none' }}
      position={[0.2 + index * 0.42, 1.25 - index * 0.62, 0]}
    >
      {word.text}
    </Text>
  ));
}

export default function DrawOrder() {
  const handle = use(handleReady);
  const [state, setState] = useState({ top: 0, grouped: 0, loose: 0 });

  useFrame(({ scene, elapsed }) => {
    const top = Math.floor(elapsed / 1.6) % WORDS.length;
    const grouped = plannedDraws(scene, 'grouped');
    const loose = plannedDraws(scene, 'loose');
    if (top !== state.top || grouped !== state.grouped || loose !== state.loose) setState({ top, grouped, loose });
  });

  const order = WORDS.map((_, step) => WORDS[(state.top + 1 + step) % WORDS.length]!.text).join(' < ');

  return (
    <>
      <Column
        x={-5.3}
        title="children of one TextGroup"
        note={`renderOrder ranks the paragraphs: ${count(state.grouped)}`}
      >
        <GlyphProvider handle={handle('grouped')}>
          <TextGroup>
            <Stack top={state.top} />
          </TextGroup>
        </GlyphProvider>
      </Column>
      <Column x={0.3} title="ungrouped Texts" note={`renderOrder is three's draw order: ${count(state.loose)}`}>
        <GlyphProvider handle={handle('loose')}>
          <Stack top={state.top} />
        </GlyphProvider>
      </Column>
      <Label x={-5} y={-2.55} width={10} color={PAPER}>{`renderOrder: ${order}`}</Label>
    </>
  );
}

function Column({
  x,
  title,
  note,
  children,
}: {
  readonly x: number;
  readonly title: string;
  readonly note: string;
  readonly children: ReactNode;
}) {
  return (
    <group position={[x, 0, 0]}>
      <Label x={0} y={2.55} width={5} color={PAPER}>
        {title}
      </Label>
      {children}
      <Label x={0} y={-1.85} width={5} color={PAPER_DIM}>
        {note}
      </Label>
    </group>
  );
}

function Label({
  x,
  y,
  width,
  color,
  children,
}: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly color: string;
  readonly children: string;
}) {
  const inter = useMsdf(INTER);
  return (
    <Text
      font={inter}
      style={{ fontSize: 0.2, color, letterSpacing: 0.01 }}
      layout={{ align: 'center', wrap: 'none' }}
      constraints={{ width: { mode: 'exact', size: width } }}
      position={[x, y, 0]}
    >
      {children}
    </Text>
  );
}
