import { readFile } from 'node:fs/promises';

import {
  glyph,
  type Constraints,
  type Font,
  type GlyphLayoutInspection,
  type ParagraphLayout,
  type TextStyle,
} from '@pmndrs/glyph';
import { loadFont } from '@pmndrs/glyph/config/font-library';
import { validateFontArtifact } from '@pmndrs/glyph/bake';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { ThreeConfig } from '@pmndrs/glyph/three';

await glyph.init();
let nextContractHandle = 1;

export type ContractFont = Font<typeof bitmap>;

/** Fixture-owned font plus authenticated shaping identity retained outside the public Font API. */
export interface ContractFontFixture {
  readonly font: ContractFont;
  readonly shapingHash: string;
  dispose(): void;
}

export interface LegacyAxis {
  readonly mode: 'unconstrained' | 'at-most' | 'exactly';
  readonly size?: number;
}

export interface LegacyConstraints {
  readonly width?: LegacyAxis;
  readonly height?: LegacyAxis;
  readonly maxLines?: number;
  readonly wrap?: 'none' | 'word' | 'character';
  readonly align?: 'start' | 'center' | 'end' | 'justify';
  readonly overflow?: 'visible' | 'clip' | 'ellipsis';
}

export async function loadContractFont(url: URL, coverage?: string): Promise<ContractFontFixture> {
  const bytes = await readFile(url);
  const [font, artifact] = await Promise.all([
    loadFont(
      { baked: { bytes, ownership: 'copy' } },
      {
        raster: bitmap,
        options: { strikes: [16], ...(coverage === undefined ? {} : { coverage: { text: coverage } }) },
      },
    ),
    validateFontArtifact(bytes),
  ]);
  return { font, shapingHash: artifact.shapingHash, dispose: () => font.dispose() };
}

export function createContractText(font: ContractFont, text: string, style: TextStyle) {
  const handle = glyph.handle(`paragraph-contract:${String(nextContractHandle++)}`, ThreeConfig);
  handle.setCapacity({ size: Math.max(1_024, text.length * 4), policy: 'grow' });
  const group = handle.createTextGroup();
  const value = handle.createText({ font, text, style });
  group.add(value);
  return {
    group,
    text: value,
    inspect(constraints: LegacyConstraints): GlyphLayoutInspection {
      value.set({ layout: layoutOnly(constraints), constraints: constraintsOnly(constraints) });
      group.updateMatrixWorld(true);
      if (group.error !== undefined) throw group.error;
      const layout = value.glyphs();
      if (layout === undefined) throw new Error('paragraph contract layout was not published');
      return layout;
    },
    dispose() {
      value.dispose();
      group.dispose();
      handle.dispose();
    },
  };
}

export function constraintsOnly(value: LegacyConstraints): Constraints {
  return {
    ...(value.width === undefined ? {} : { width: axis(value.width) }),
    ...(value.height === undefined ? {} : { height: axis(value.height) }),
  };
}

export function layoutOnly(value: LegacyConstraints): ParagraphLayout {
  return {
    ...(value.maxLines === undefined ? {} : { maxLines: value.maxLines }),
    ...(value.wrap === undefined ? {} : { wrap: value.wrap }),
    ...(value.align === undefined ? {} : { align: value.align }),
    ...(value.overflow === undefined ? {} : { overflow: value.overflow }),
  };
}

/** Retains historical pre-ABI numeric literals only when the public f32 value is exactly equivalent. */
export function preserveEquivalentLegacyNumbers(current: unknown, retained: unknown): unknown {
  if (typeof current === 'number' && typeof retained === 'number') {
    return Object.is(Math.fround(current), Math.fround(retained)) ? retained : current;
  }
  if (Array.isArray(current) && Array.isArray(retained)) {
    return current.map((value, index) => preserveEquivalentLegacyNumbers(value, retained[index]));
  }
  if (isRecord(current) && isRecord(retained)) {
    return Object.fromEntries(
      Object.entries(current).map(([key, value]) => [key, preserveEquivalentLegacyNumbers(value, retained[key])]),
    );
  }
  return current;
}

function axis(value: LegacyAxis) {
  if (value.mode === 'unconstrained') return { mode: 'unconstrained' as const };
  if (value.size === undefined) throw new Error(`${value.mode} constraint omitted its size`);
  return { mode: value.mode === 'exactly' ? ('exact' as const) : ('at-most' as const), size: value.size };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
