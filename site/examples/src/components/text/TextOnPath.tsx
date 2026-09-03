import { Text } from '@pmndrs/glyph/react';
import type { Font } from '@pmndrs/glyph';
import type { Glyphs, Text as ThreeText, ThreeTextMaterial } from '@pmndrs/glyph/three';
import type { AnyRasterFormat } from '@pmndrs/glyph';
import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useRef } from 'react';
import { Matrix4 } from 'three/webgpu';

import { placeOnPath, type Path } from '../../lib/paths';

/**
 * A line of text that flows along a path. The line is shaped once as an
 * ordinary paragraph; once it commits, its glyphs are copied out with
 * `breakApart()` and, every frame, each copy is placed on the path by its
 * advance — arc length — plus `speed × elapsed`. The path's frame decides
 * which way the letters stand.
 */
export function TextOnPath<Technique extends AnyRasterFormat>({
  font,
  path,
  speed = 0,
  height = 0,
  size = 0.4,
  color = '#e7ecf6',
  letterSpacing = 0.06,
  material,
  children,
}: {
  readonly font: Font<Technique>;
  readonly path: Path;
  readonly speed?: number;
  /** How far the baseline sits from the path along its normal; a tube's radius puts the type on its surface. */
  readonly height?: number;
  readonly size?: number;
  readonly color?: string;
  readonly letterSpacing?: number;
  readonly material?: ThreeTextMaterial;
  readonly children: string;
}) {
  const source = useRef<ThreeText<Technique>>(null);
  const copy = useRef<{ glyphs: Glyphs; width: number } | undefined>(undefined);

  useEffect(
    () => () => {
      copy.current?.glyphs.dispose();
      copy.current = undefined;
    },
    [],
  );

  useFrame(({ elapsed }) => {
    const text = source.current;
    if (copy.current === undefined) {
      if (text === null || text.commitState().status !== 'committed') return;
      const [glyphs] = text.breakApart();
      text.parent?.add(glyphs);
      text.visible = false;
      copy.current = { glyphs, width: text.measure().contentWidth };
    }
    const { glyphs, width } = copy.current;
    const m = new Matrix4();
    for (let i = 0; i < glyphs.count; i += 1) {
      const rest = glyphs.measurements[i];
      if (rest === undefined) continue;
      // The line tiles the path exactly once: advance along the line scales to arc length.
      const s = (rest.originalMatrix.elements[12] ?? 0) * (path.length / width) + elapsed * speed;
      glyphs.setMatrixAt(i, placeOnPath(path, s, 0, height, rest.originalMatrix, m));
    }
  });

  return (
    <Text
      ref={source}
      font={font}
      {...(material === undefined ? {} : { material })}
      style={{ fontSize: size, color, letterSpacing }}
      layout={{ wrap: 'none' }}
      constraints={{ width: { mode: 'exact', size: 60 } }}
    >
      {children}
    </Text>
  );
}
