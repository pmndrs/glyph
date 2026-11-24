import { createFontStack } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useMemo } from 'react';

import { Caption } from '../../components/text';
import { ICONS_MSDF, ICONS_MSDF_OPTIONS, INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';

/**
 * An icon font is a font whose glyphs sit on private-use code points. Top:
 * six icons, each its own Text, with the code point that selects it. Bottom:
 * the same icons inside ordinary strings, through a stack whose primary is
 * Inter and whose fallback is the icon subset, and one nested span that gives
 * an icon its own color.
 */
export const ICONS = [
  ['rocket', 0xf135],
  ['paintbrush', 0xf1fc],
  ['palette', 0xf53f],
  ['bolt', 0xf0e7],
  ['power-off', 0xf011],
  ['pen-to-square', 0xf044],
] as const;

const icon = (name: (typeof ICONS)[number][0]): string =>
  String.fromCodePoint(ICONS.find(([candidate]) => candidate === name)![1]);

export default function FontsIcons() {
  const inter = useMsdf(INTER);
  const icons = useMsdf(ICONS_MSDF, ICONS_MSDF_OPTIONS);
  const stack = useMemo(() => createFontStack(inter, icons), [inter, icons]);
  const step = 1.6;

  return (
    <>
      {ICONS.map(([name, codePoint], index) => {
        const x = -4.8 + index * step;
        return (
          <group key={name}>
            <Text
              font={icons}
              style={{ fontSize: 0.8, color: PAPER }}
              layout={{ align: 'center', wrap: 'none' }}
              constraints={{ width: { mode: 'exact', size: step } }}
              position={[x, 2.3, 0]}
            >
              {String.fromCodePoint(codePoint)}
            </Text>
            <Caption x={x} y={1.25} width={step} size={0.16}>
              {name}
            </Caption>
            <Caption x={x} y={1.0} width={step} size={0.16}>
              {`U+${codePoint.toString(16).toUpperCase()}`}
            </Caption>
          </group>
        );
      })}

      <Text
        font={inter}
        style={{ fontSize: 0.18, color: PAPER_DIM, letterSpacing: 0.02 }}
        layout={{ wrap: 'none' }}
        position={[-4.6, 0.1, 0]}
      >
        {'font={createFontStack(inter, icons)}'}
      </Text>
      <Text font={stack} style={{ fontSize: 0.5, color: PAPER }} layout={{ wrap: 'none' }} position={[-4.6, -0.3, 0]}>
        {`${icon('rocket')} Launch   ${icon('pen-to-square')} Edit   ${icon('power-off')} Shut down`}
      </Text>

      <Text
        font={inter}
        style={{ fontSize: 0.18, color: PAPER_DIM, letterSpacing: 0.02 }}
        layout={{ wrap: 'none' }}
        position={[-4.6, -1.45, 0]}
      >
        {'nested <Text font={icons} style={{ color }}>'}
      </Text>
      <Text font={inter} style={{ fontSize: 0.5, color: PAPER }} layout={{ wrap: 'none' }} position={[-4.6, -1.85, 0]}>
        Charging{' '}
        <Text font={icons} style={{ color: ACCENT }}>
          {icon('bolt')}
        </Text>{' '}
        82%
      </Text>
    </>
  );
}
