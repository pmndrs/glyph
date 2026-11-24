import { createFontStack, type Font, type FontStack, type msdf } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useMemo, useState } from 'react';

import { CHORUS, CHORUS_MSDF, INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';

/**
 * One string, two font selections. Inter alone has only Basic Latin, so every
 * kanji, Hebrew letter and the omega falls to `.notdef`, which this subset
 * draws as nothing: the gold boxes mark where those glyphs sit. The stack
 * tries Inter, then a Japanese face, then a Hebrew face for each grapheme
 * cluster; only the omega, which no member covers, is still missing. Boxes and
 * counts are read from the layout, not written by hand.
 */
export const SAMPLE = 'glyph 字形 אות Ω';
const SIZE = 0.95;

type Selection = Font<typeof msdf> | FontStack<typeof msdf>;
/** Advance boxes of the `.notdef` glyphs: left edge and width, in Text-local units. */
type Missing = readonly (readonly [x: number, width: number])[];

export default function FontsFallback() {
  const inter = useMsdf(INTER);
  const japanese = useMsdf(CHORUS.japanese, CHORUS_MSDF);
  const hebrew = useMsdf(CHORUS.hebrew, CHORUS_MSDF);
  const stack = useMemo(() => createFontStack(inter, japanese, hebrew), [inter, japanese, hebrew]);

  return (
    <>
      <Row y={2.1} label="font={inter}" font={inter} caption={inter} />
      <Row y={-0.4} label="font={createFontStack(inter, japanese, hebrew)}" font={stack} caption={inter} />
    </>
  );
}

function Row({
  y,
  label,
  font,
  caption,
}: {
  readonly y: number;
  readonly label: string;
  readonly font: Selection;
  readonly caption: Font<typeof msdf>;
}) {
  const [missing, setMissing] = useState<Missing>([]);
  const [baseline, setBaseline] = useState(0);
  return (
    <group position={[-4.6, y, 0]}>
      <Text font={caption} style={{ fontSize: 0.2, color: PAPER_DIM, letterSpacing: 0.02 }} layout={{ wrap: 'none' }}>
        {label}
      </Text>
      <group position={[0, -0.42, 0]}>
        <Text
          font={font}
          style={{ fontSize: SIZE, color: PAPER }}
          layout={{ wrap: 'none' }}
          onLayout={(text, layout) => {
            // Glyph 0 is the font's `.notdef`: what a cluster becomes when no font in the selection covers it.
            const next = text.readGlyphs((glyphs) => {
              const boxes: [number, number][] = [];
              for (let index = 0; index < glyphs.glyphCount; index += 1) {
                const glyph = glyphs.glyphAt(index);
                if (glyph.glyphId === 0) boxes.push([glyph.x, glyph.advance]);
              }
              return boxes;
            });
            setBaseline(layout.firstBaseline);
            setMissing((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
          }}
        >
          {SAMPLE}
        </Text>
        {missing.map(([x, width]) => (
          <Box key={x} x={x + 0.04} y={-baseline} width={Math.max(width - 0.08, 0.1)} height={SIZE * 0.72} />
        ))}
      </group>
      <Text
        font={caption}
        style={{ fontSize: 0.2, color: ACCENT, letterSpacing: 0.02 }}
        layout={{ wrap: 'none' }}
        position={[0, -1.72, 0]}
      >
        {`missingGlyphCount ${missing.length}`}
      </Text>
    </group>
  );
}

/** A thin gold frame standing on the baseline at `y`. */
function Box({
  x,
  y,
  width,
  height,
}: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}) {
  const t = 0.02;
  return (
    <group position={[x + width / 2, y + height / 2, 0.005]}>
      {(
        [
          [0, height / 2, width, t],
          [0, -height / 2, width, t],
          [-width / 2, 0, t, height],
          [width / 2, 0, t, height],
        ] as const
      ).map(([px, py, w, h]) => (
        <mesh key={`${px}:${py}`} position={[px, py, 0]}>
          <planeGeometry args={[w, h]} />
          <meshBasicNodeMaterial color={ACCENT} />
        </mesh>
      ))}
    </group>
  );
}
