import type { msdf } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';
import { Frame } from '../inspect-line-metrics/Frame';

const WORD = 'Typography';
const FONT_SIZE = 1.5;
const ADVANCE = '#5b6577';

interface GlyphBox {
  readonly index: number;
  readonly cluster: number;
  readonly penX: number;
  readonly penY: number;
  readonly advance: number;
  readonly ink: readonly [x: number, y: number, width: number, height: number];
}

interface Inspection {
  readonly width: number;
  readonly top: number;
  readonly lineHeight: number;
  readonly glyphs: readonly GlyphBox[];
}

/**
 * One box per glyph from the columns of `glyphs()`. The grey box is what layout reserved: from the pen
 * position `x[i]`, `glyphAdvances[i]` wide, the line box tall. The gold box is what the glyph draws:
 * `glyphInkX/Y/Widths/Heights[i]`. The dot is the pen position on the baseline.
 */
export default function InspectGlyphs() {
  const inter = useMsdf(INTER);
  const ref = useRef<ThreeText<typeof msdf>>(null);
  const [inspection, setInspection] = useState<Inspection | undefined>(undefined);

  useFrame(() => {
    const text = ref.current;
    if (text === null || inspection !== undefined) return;
    // One copy of every column; the arrays are this scene's to keep.
    const layout = text.glyphs();
    const line = layout.lines[0];
    if (line === undefined) return;
    const glyphs: GlyphBox[] = [];
    for (let index = 0; index < layout.glyphCount; index += 1) {
      glyphs.push({
        index,
        cluster: layout.clusters[index]!,
        penX: layout.x[index]!,
        penY: layout.y[index]!,
        advance: layout.glyphAdvances[index]!,
        ink: [
          layout.glyphInkX[index]!,
          layout.glyphInkY[index]!,
          layout.glyphInkWidths[index]!,
          layout.glyphInkHeights[index]!,
        ],
      });
    }
    setInspection({ width: layout.width, top: line.baseline - line.ascent, lineHeight: line.lineHeight, glyphs });
  });

  return (
    <group position={inspection === undefined ? [-4, 1.6, 0] : [-inspection.width / 2, 1.6, 0]}>
      <Text ref={ref} font={inter} style={{ fontSize: FONT_SIZE, color: PAPER }} layout={{ wrap: 'none' }}>
        {WORD}
      </Text>
      {inspection?.glyphs.map((glyph) => (
        <group key={glyph.index}>
          <Frame
            x={glyph.penX}
            y={inspection.top}
            width={glyph.advance}
            height={inspection.lineHeight}
            color={ADVANCE}
            thickness={0.01}
          />
          <Frame x={glyph.ink[0]} y={glyph.ink[1]} width={glyph.ink[2]} height={glyph.ink[3]} color={ACCENT} />
          <mesh position={[glyph.penX, -glyph.penY, 0.02]}>
            <circleGeometry args={[0.035, 16]} />
            <meshBasicNodeMaterial color={PAPER} />
          </mesh>
          <Text
            font={inter}
            style={{ fontSize: 0.17, color: PAPER_DIM, letterSpacing: 0.02 }}
            layout={{ wrap: 'none', align: 'center' }}
            constraints={{ width: { mode: 'exact', size: glyph.advance } }}
            position={[glyph.penX, -(inspection.top + inspection.lineHeight) - 0.12, 0]}
          >
            {`${glyph.index}\n${glyph.advance.toFixed(2)}`}
          </Text>
        </group>
      ))}
      {inspection !== undefined && (
        <>
          <Legend font={inter} x={0} y={-(inspection.top + inspection.lineHeight) - 0.95} color={PAPER_DIM}>
            {'under each glyph: its index and glyphAdvances[i]'}
          </Legend>
          <Legend font={inter} x={0} y={-(inspection.top + inspection.lineHeight) - 1.3} color={ADVANCE_LABEL}>
            {'grey: advance box, from x[i], glyphAdvances[i] wide'}
          </Legend>
          <Legend font={inter} x={0} y={-(inspection.top + inspection.lineHeight) - 1.65} color={ACCENT}>
            {'gold: ink box, glyphInkX, glyphInkY, glyphInkWidths, glyphInkHeights'}
          </Legend>
          <Legend font={inter} x={0} y={-(inspection.top + inspection.lineHeight) - 2.0} color={PAPER}>
            {'dot: pen position (x[i], y[i]) on the baseline'}
          </Legend>
        </>
      )}
    </group>
  );
}

const ADVANCE_LABEL = '#7b8496';

function Legend({
  font,
  x,
  y,
  color,
  children,
}: {
  readonly font: ReturnType<typeof useMsdf>;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly children: string;
}) {
  return (
    <Text
      font={font}
      style={{ fontSize: 0.22, color, letterSpacing: 0.02 }}
      layout={{ wrap: 'none' }}
      position={[x, y, 0]}
    >
      {children}
    </Text>
  );
}
