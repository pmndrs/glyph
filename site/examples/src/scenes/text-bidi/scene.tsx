import { Text, useMsdf, useSlug } from '@pmndrs/glyph/react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';
import { LONG, MIXED } from './config';

/**
 * Base direction, alignment and the ellipsis side. The top three rows set one
 * mixed Latin and Arabic string with `align: 'start'` in the same box and
 * change only `style.direction`: `auto` takes the direction of the first
 * strong character (a Latin letter, so left to right), and `rtl` flips both
 * the order of the runs and the edge `start` means. The bottom rows truncate
 * one line: the ellipsis sits at the end of the line, which is the right edge
 * under `ltr` and the left edge under `rtl`.
 */
export const AMIRI = new URL('../../../../docs/assets/fonts/styling/amiri-arabic.font.glb', import.meta.url).href;

export const DIRECTIONS = ['auto', 'ltr', 'rtl'] as const;
export const TRUNCATED = [
  { direction: 'ltr', text: 'hello glyph hello glyph hello glyph' },
  { direction: 'rtl', text: LONG },
] as const;

export const BOX_X = -2.4;
export const WIDE = 5.6;
export const NARROW = 3.4;
const LINE = 0.66;

function Box({ width }: { readonly width: number }) {
  return (
    <mesh position={[width / 2, -LINE / 2, -0.01]}>
      <planeGeometry args={[width, LINE]} />
      <meshBasicNodeMaterial color="#141925" />
    </mesh>
  );
}

export default function Bidi() {
  const inter = useMsdf(INTER);
  const amiri = useSlug(AMIRI);
  const caption = { fontSize: 0.16, color: PAPER_DIM, letterSpacing: 0.02 } as const;
  const sample = { fontSize: 0.4, lineHeight: 1.65 } as const;

  return (
    <>
      <Text font={inter} style={caption} layout={{ wrap: 'none' }} position={[BOX_X, 2.85, 0]}>
        {"layout: { align: 'start' }"}
      </Text>
      {DIRECTIONS.map((direction, index) => (
        <group key={direction} position={[BOX_X, 2.45 - index * 0.86, 0]}>
          <Text font={inter} style={caption} layout={{ wrap: 'none' }} position={[-2.7, -0.22, 0]}>
            {`direction: '${direction}'`}
          </Text>
          <Box width={WIDE} />
          <Text
            font={amiri}
            style={[sample, { color: direction === 'rtl' ? ACCENT : PAPER, direction }]}
            layout={{ align: 'start', wrap: 'none' }}
            constraints={{ width: { mode: 'exact', size: WIDE } }}
          >
            {MIXED}
          </Text>
        </group>
      ))}
      <Text font={inter} style={caption} layout={{ wrap: 'none' }} position={[BOX_X, -0.45, 0]}>
        {"layout: { overflow: 'ellipsis', maxLines: 1 }"}
      </Text>
      {TRUNCATED.map((row, index) => (
        <group key={row.direction} position={[BOX_X, -0.85 - index * 0.86, 0]}>
          <Text font={inter} style={caption} layout={{ wrap: 'none' }} position={[-2.7, -0.22, 0]}>
            {`direction: '${row.direction}'`}
          </Text>
          <Box width={NARROW} />
          <Text
            font={amiri}
            style={[sample, { color: row.direction === 'rtl' ? ACCENT : PAPER, direction: row.direction }]}
            layout={{ align: 'start', wrap: 'none', overflow: 'ellipsis', maxLines: 1 }}
            constraints={{ width: { mode: 'exact', size: NARROW } }}
          >
            {row.text}
          </Text>
        </group>
      ))}
    </>
  );
}
