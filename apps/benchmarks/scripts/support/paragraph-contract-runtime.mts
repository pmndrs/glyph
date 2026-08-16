import { readFile } from 'node:fs/promises';

import {
  createTextRuntime,
  FontRegistry,
  type LoadedFont,
  type ParagraphContentBox,
  type ParagraphLayoutInspection,
  type ParagraphStyle,
} from '@pmndrs/glyph';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { Text, TextGroup, type TextUpdate } from '@pmndrs/glyph/three';

import type { UikitParagraphSubject } from '../../src/benchmark/uikit-layout-fixture.ts';

export type ContractFont = LoadedFont<typeof bitmap>;

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

export async function createParagraphContractRuntime() {
  const registry = new FontRegistry();
  const runtime = await createTextRuntime({
    registry,
    wasm: await readFile(new URL('../../../../packages/glyph/dist/text_shaper.wasm', import.meta.url)),
  });
  return {
    async loadFont(url: URL, coverage?: string) {
      return runtime.loadFont({
        input: { baked: dataUrl(await readFile(url)) },
        raster: {
          technique: bitmap,
          options: { strikes: [16], ...(coverage === undefined ? {} : { coverage: { text: coverage } }) },
        },
      });
    },
    dispose() {
      runtime.dispose();
    },
  };
}

export function createContractText(font: ContractFont, text: string, style: ParagraphStyle) {
  const group = new TextGroup({ capacity: { size: Math.max(1_024, text.length * 4), policy: 'grow' } });
  const value = new Text({ font, text, style });
  group.add(value);
  return {
    group,
    text: value,
    inspect(constraints: LegacyConstraints): ParagraphLayoutInspection {
      value.contentBox = contentBox(constraints);
      group.updateMatrixWorld(true);
      if (group.error !== undefined) throw group.error;
      const layout = value.inspectLayout();
      if (layout === undefined) throw new Error('paragraph contract layout was not published');
      return layout;
    },
    dispose() {
      value.dispose();
      group.dispose();
    },
  };
}

export function textSubject(
  group: TextGroup,
  text: Text<typeof bitmap>,
  input: { readonly text: string; readonly style: ParagraphStyle },
): UikitParagraphSubject<TextUpdate<typeof bitmap>> {
  let key = '';
  const apply = (value: ParagraphContentBox) => {
    const next = JSON.stringify(value);
    if (next === key) return;
    key = next;
    text.contentBox = value;
    group.updateMatrixWorld(true);
    if (group.error !== undefined) throw group.error;
  };
  return {
    measure(value) {
      apply(value);
      const measured = text.measureLayout();
      if (measured === undefined) throw new Error('paragraph contract measurement was not published');
      return measured;
    },
    layout(value) {
      apply(value);
      const layout = text.inspectLayout();
      if (layout === undefined) throw new Error('paragraph contract layout was not published');
      return layout;
    },
    update(value) {
      text.set({ ...input, ...value });
      key = '';
    },
  };
}

export function contentBox(value: LegacyConstraints): ParagraphContentBox {
  return {
    ...(value.width === undefined ? {} : { width: axis(value.width) }),
    ...(value.height === undefined ? {} : { height: axis(value.height) }),
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

function dataUrl(bytes: Uint8Array): string {
  return `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
