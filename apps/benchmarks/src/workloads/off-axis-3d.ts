import { Text } from '@pmndrs/text';
import * as THREE from 'three/webgpu';

import { createOklabColorCycle } from './shared/oklab-color-cycle';
import { benchmarkContentWidth, LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from './shared/text-style';

import type { ComparisonWorkloadConfiguration, ComparisonWorkloadDefinition } from './contracts';
import {
  committedTextLayout,
  type ComparisonWorkloadEntry,
  type MutablePaintSpan,
  type WorkloadTextFactoryContext,
} from './factory-contracts';

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

export function layoutOffAxis3dEntries(
  entries: readonly ComparisonWorkloadEntry[],
  viewportWidth: number,
  viewportHeight: number,
): void {
  const entry = entries[0];
  if (entry === undefined) return;
  const layout = committedTextLayout(entry.text);
  entry.text.position.set(-layout.width / 2, layout.height / 2, 0);
  entry.node.position.set(viewportWidth * (0.5 + OFF_AXIS_HORIZONTAL_BIAS_RATIO), -viewportHeight / 2, 0);
}

export function animateOffAxis3dEntries(
  entries: readonly ComparisonWorkloadEntry[],
  configuration: Pick<ComparisonWorkloadConfiguration, 'amount' | 'animationEnabled' | 'animationSpeed'>,
  timestamp: number,
): void {
  const entry = entries[0];
  if (entry === undefined) return;
  const motionTimestamp = configuration.animationEnabled ? timestamp : 0;
  const strength = 0.7 + (configuration.amount / 100) * 0.3;
  const phase = motionTimestamp * 0.00055 * animationRate(configuration.animationSpeed);
  entry.node.rotation.set(
    (-0.08 + Math.sin(phase * 0.83) * 0.18) * strength,
    (0.62 + Math.sin(phase + Math.PI / 2) * 0.2) * strength,
    Math.sin(phase * 0.47) * 0.06 * strength,
  );
  entry.node.position.z = -(320 + Math.sin(phase * 0.61) * 60) * strength;
  if (!configuration.animationEnabled) return;
  if (entry.offAxisSpans === undefined || entry.offAxisPaintUpdate === undefined) {
    throw new Error('off-axis text is missing its retained color spans');
  }
  const colorPhase = (timestamp / 32_000) * animationRate(configuration.animationSpeed);
  for (let index = 0; index < entry.offAxisSpans.length; index += 1) {
    entry.offAxisSpans[index]!.color = offAxisColorAt(index, colorPhase);
  }
  entry.text.setProperties(entry.offAxisPaintUpdate);
}

function animationRate(animationSpeed: number): number {
  return 0.25 + animationSpeed * 0.0175;
}
