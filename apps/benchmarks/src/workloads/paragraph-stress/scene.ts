import { Text } from '@pmndrs/text';
import type * as THREE from 'three/webgpu';

import { benchmarkIpsumText } from '../../benchmark/font-fixtures';
import { paragraphStressScrollProgress } from '../../benchmark/paragraph-stress-motion';
import type { ComparisonWorkloadConfiguration, ComparisonWorkloadDefinition } from '../comparison/contracts';
import { benchmarkContentWidth, LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from '../shared/text-style';
import {
  committedTextLayout,
  type ComparisonWorkloadEntry,
  type WorkloadTextFactoryContext,
} from '../shared/scene-entry';

export const paragraphStressWorkload = {
  animate(entries, configuration, elapsedMs, _viewportWidth, viewportHeight, scene) {
    if (!configuration.animationEnabled) return;
    animateParagraphStressScene(scene, entries, configuration, elapsedMs, viewportHeight);
  },
  applyRetainedConfiguration() {},
  cameraKind: 'orthographic',
  contentWidth: {},
  create(context) {
    return createParagraphStressEntries({
      ...context.configuration,
      dpr: context.dpr,
      font: context.font,
      raster: context.raster,
      viewportWidth: context.viewportWidth,
    });
  },
  id: 'paragraph-stress',
  layout(entries, context) {
    layoutParagraphStressEntries(entries, context.viewportWidth, context.viewportHeight);
  },
  suspendsIconWindow: false,
  updateKind: (previous: ComparisonWorkloadConfiguration, next: ComparisonWorkloadConfiguration) =>
    previous.amount === next.amount ? 'retained' : 'rebuild',
} satisfies ComparisonWorkloadDefinition;

export function createParagraphStressEntries(
  context: WorkloadTextFactoryContext & {
    readonly amount: number;
    readonly fontSize: number;
    readonly layoutWidthRatio: number;
    readonly viewportWidth: number;
  },
): readonly ComparisonWorkloadEntry[] {
  const sourceText = Array.from({ length: Math.max(2, Math.round(context.amount / 10)) }, () =>
    benchmarkIpsumText(),
  ).join('\n');
  const text = new Text({
    font: context.font,
    raster: context.raster,
    rasterPixelRatio: context.dpr,
    lineHeight: LIVE_TEXT_LINE_HEIGHT,
    text: sourceText,
    fontSize: context.fontSize,
    color: LIVE_TEXT_COLOR,
    width: benchmarkContentWidth(context.viewportWidth, context.layoutWidthRatio),
    wrap: 'word',
  });
  return [{ node: text, role: 'primary', sourceText, text }];
}

export function layoutParagraphStressEntries(
  entries: readonly ComparisonWorkloadEntry[],
  viewportWidth: number,
  viewportHeight: number,
): void {
  const entry = entries[0];
  if (entry === undefined) return;
  const layout = committedTextLayout(entry.text);
  entry.text.position.set(
    Math.max(12, (viewportWidth - layout.width) / 2),
    -Math.max(12, (viewportHeight - layout.height) / 2),
    0,
  );
}

export function animateParagraphStressScene(
  scene: THREE.Scene,
  entries: readonly ComparisonWorkloadEntry[],
  configuration: Pick<ComparisonWorkloadConfiguration, 'animationSpeed'>,
  elapsedMs: number,
  viewportHeight: number,
): void {
  const entry = entries[0];
  if (entry === undefined) return;
  const layout = committedTextLayout(entry.text);
  const scrollProgress = paragraphStressScrollProgress(elapsedMs, configuration.animationSpeed);
  const maximumScrollY = Math.max(0, layout.height - viewportHeight + 24);
  scene.position.y = maximumScrollY * scrollProgress;
}
