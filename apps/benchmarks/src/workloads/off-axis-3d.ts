import { Text } from '@pmndrs/text';
import * as THREE from 'three/webgpu';

import { benchmarkContentWidth, LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from '../renderer/live-text-style';
import { createOklabColorCycle } from '../renderer/oklab-color-cycle';

import type { ComparisonWorkloadDefinition } from './contracts';
import type { ComparisonWorkloadEntry, MutablePaintSpan, WorkloadTextFactoryContext } from './factory-contracts';

export const OFF_AXIS_HORIZONTAL_BIAS_RATIO = 0.075;
export const OFF_AXIS_TEXT =
  'Render shaped text directly in your canvas, without the DOM. It reflows at runtime and uses the scene camera and depth. Bitmap, MSDF, Slug.';
const OFF_AXIS_WORD_COLORS = [
  { color: 0xa855f7, word: 'shaped' },
  { color: 0x22d3ee, word: 'canvas' },
  { color: 0x34d399, word: 'reflows' },
  { color: 0xf59e0b, word: 'Bitmap' },
  { color: 0xfb7185, word: 'MSDF' },
  { color: 0xff4dc4, word: 'Slug' },
] as const;
export const OFF_AXIS_SPANS: readonly MutablePaintSpan[] = OFF_AXIS_WORD_COLORS.map(({ color, word }) => {
  const start = OFF_AXIS_TEXT.indexOf(word);
  if (start === -1) throw new Error(`off-axis callout is missing its ${word} color span`);
  return { color, end: start + word.length, start };
});
const colorAt = createOklabColorCycle(OFF_AXIS_WORD_COLORS.map(({ color }) => color));

export const offAxis3dWorkload = {
  cameraKind: 'perspective',
  contentWidth: { multiplier: 2 },
  id: 'off-axis-3d',
  suspendsIconWindow: false,
  updateKind: () => 'retained',
} satisfies ComparisonWorkloadDefinition;

export function offAxisColorAt(index: number, phase: number): number {
  return colorAt(index, phase);
}

export function createOffAxis3dEntries(
  context: WorkloadTextFactoryContext & {
    readonly fontSize: number;
    readonly layoutWidthRatio: number;
    readonly viewportWidth: number;
  },
): readonly ComparisonWorkloadEntry[] {
  const spans = OFF_AXIS_SPANS.map((span) => ({ ...span }));
  const text = new Text({
    font: context.font,
    raster: context.raster,
    rasterPixelRatio: context.dpr,
    lineHeight: LIVE_TEXT_LINE_HEIGHT,
    text: OFF_AXIS_TEXT,
    spans,
    fontSize: context.fontSize,
    color: LIVE_TEXT_COLOR,
    width: benchmarkContentWidth(context.viewportWidth, context.layoutWidthRatio, undefined, 2),
    wrap: 'word',
    textAlign: 'center',
  });
  const node = new THREE.Group();
  node.add(text);
  return [
    {
      node,
      role: 'primary',
      sourceText: OFF_AXIS_TEXT,
      text,
      offAxisSpans: spans,
      offAxisPaintUpdate: { text: OFF_AXIS_TEXT, spans },
    },
  ];
}
