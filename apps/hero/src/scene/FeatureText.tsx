import { Text } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';

import type { Faces } from '../fonts';
import { pattern } from '../materials/ink';
import { latestShockwave } from './shockwave';

const FEATURES =
  'Portable font baking, Unicode shaping and paragraph layout, bidi and CJK line breaking, Bitmap, MSDF and Slug rasters, batched draws on WebGPU and WebGL2, React Three Fiber and TypeGPU integrations, and no DOM anywhere.';
/** Characters per second: fast enough to feel typed, not printed. */
const RATE = 62;
const FONT_SIZE = 0.3;
/** Gap between the word's baseline and the top of the field. */
const GAP = 0.42;

/**
 * The feature copy under the word, justified to the same measure. Characters are appended for real, so each one
 * re-breaks and re-justifies the paragraph and the ragged last line grows under the cursor as it fills.
 */
export function FeatureText({
  faces,
  width,
  top,
}: {
  readonly faces: Faces;
  readonly width: number;
  readonly top: number;
}) {
  const [revealed, setRevealed] = useState(0);
  const started = useRef<number | undefined>(undefined);
  const wave = useRef(0);

  useFrame(() => {
    const shock = latestShockwave();
    if (shock !== undefined && shock.id !== wave.current) {
      // The word has landed: start typing while it is still settling.
      wave.current = shock.id;
      started.current = performance.now();
      setRevealed(0);
    }
    const start = started.current;
    if (start === undefined) return;
    const next = Math.min(FEATURES.length, Math.floor(((performance.now() - start) / 1000) * RATE));
    if (next !== revealed) setRevealed(next);
  });

  if (width <= 0) return null;
  return (
    <Text
      constraints={{ width: { mode: 'exact', size: width } }}
      font={faces['geist-medium']}
      layout={{ align: 'justify', wrap: 'word' }}
      material={pattern}
      position={[-width / 2, top - GAP, 0]}
      style={{ color: '#15161a', fontSize: FONT_SIZE, lineHeight: 1.15 }}
    >
      {FEATURES.slice(0, revealed)}
    </Text>
  );
}
