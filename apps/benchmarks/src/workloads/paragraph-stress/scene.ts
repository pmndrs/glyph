import type { ParagraphLayoutSummary } from '@pmndrs/glyph';
import type * as THREE from 'three/webgpu';

import { benchmarkIpsumText } from '../../benchmark/font-fixtures';
import { setParagraphStressMotionFrame } from '../../benchmark/paragraph-stress-motion';
import type {
  ComparisonWorkloadAnimationScratch,
  ComparisonWorkloadConfiguration,
  ComparisonWorkloadDefinition,
  ComparisonWorkloadReflowPhases,
} from '../comparison/contracts';
import { benchmarkContentWidth, LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from '../shared/text-style';
import {
  committedTextMetrics,
  exactWidth,
  paintColor,
  publishWorkloadTexts,
  type ComparisonWorkloadEntry,
  type WorkloadTextFactoryContext,
} from '../shared/scene-entry';

const widthOnlyMotion =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('paragraphStressWidthOnly') === '1';

export const paragraphStressWorkload = {
  animate(entries, configuration, elapsedMs, viewportWidth, viewportHeight, scene, scratch, onError, onReflow) {
    animateParagraphStressScene(
      scene,
      entries,
      configuration,
      elapsedMs,
      viewportWidth,
      viewportHeight,
      scratch.paragraphStress,
      onError,
      onReflow,
    );
  },
  applyRetainedConfiguration() {},
  // One Text holding a large repeated-ipsum body is already a batch of one, so a shared group would prove nothing
  // here. Staying standalone also keeps this lane's draw and glyph telemetry directly comparable to merged v0.
  batching: 'standalone',
  cameraKind: 'orthographic',
  contentWidth: {},
  create(context) {
    return createParagraphStressEntries({
      ...context.configuration,
      dpr: context.dpr,
      font: context.font,
      root: context.root,
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
  const text = context.root.createText({
    font: context.font,
    rasterPixelRatio: context.dpr,
    text: sourceText,
    style: { fontSize: context.fontSize, lineHeight: LIVE_TEXT_LINE_HEIGHT, color: paintColor(LIVE_TEXT_COLOR) },
    constraints: { width: exactWidth(benchmarkContentWidth(context.viewportWidth, context.layoutWidthRatio)) },
    layout: { wrap: 'word' },
  });
  return [
    {
      node: text,
      role: 'primary',
      sourceText,
      text,
      lastWidth: benchmarkContentWidth(context.viewportWidth, context.layoutWidthRatio),
    },
  ];
}

export function layoutParagraphStressEntries(
  entries: readonly ComparisonWorkloadEntry[],
  viewportWidth: number,
  viewportHeight: number,
): ParagraphLayoutSummary | undefined {
  const entry = entries[0];
  if (entry === undefined) return;
  const layout = committedTextMetrics(entry.text);
  entry.text.position.set(
    Math.max(12, (viewportWidth - layout.width) / 2),
    -Math.max(12, (viewportHeight - layout.height) / 2),
    0,
  );
  return layout;
}

export function animateParagraphStressScene(
  scene: THREE.Scene,
  entries: readonly ComparisonWorkloadEntry[],
  configuration: Pick<
    ComparisonWorkloadConfiguration,
    'animationEnabled' | 'animationSpeed' | 'fontSize' | 'layoutWidthRatio'
  >,
  elapsedMs: number,
  viewportWidth: number,
  viewportHeight: number,
  frame: ComparisonWorkloadAnimationScratch['paragraphStress'],
  onError: (error: unknown) => void,
  onReflow: (duration: number, phases?: ComparisonWorkloadReflowPhases) => void,
): void {
  const entry = entries[0];
  if (entry === undefined) return;
  if (configuration.animationEnabled) {
    setParagraphStressMotionFrame(frame, elapsedMs, configuration.animationSpeed, configuration.fontSize);
    if (widthOnlyMotion) frame.fontSize = configuration.fontSize;
  } else {
    frame.fontSize = configuration.fontSize;
    frame.layoutWidthPercent = configuration.layoutWidthRatio * 100;
  }
  const width = benchmarkContentWidth(viewportWidth, frame.layoutWidthPercent / 100);
  const fontSizeChanged = entry.text.style.fontSize !== frame.fontSize;
  const widthChanged = entry.lastWidth === undefined || Math.abs(width - entry.lastWidth) >= 1;
  let layout: ParagraphLayoutSummary | undefined;
  if (fontSizeChanged || widthChanged) {
    const started = performance.now();
    try {
      entry.lastWidth = width;
      const stageStarted = performance.now();
      entry.text.set({
        ...(fontSizeChanged ? { style: { ...entry.text.style, fontSize: frame.fontSize } } : {}),
        ...(widthChanged ? { constraints: { ...entry.text.constraints, width: exactWidth(width) } } : {}),
      });
      const stageMs = performance.now() - stageStarted;
      const publishStarted = performance.now();
      publishWorkloadTexts(scene, entries);
      const publishMs = performance.now() - publishStarted;
      const layoutStarted = performance.now();
      layout = layoutParagraphStressEntries(entries, viewportWidth, viewportHeight);
      const layoutMs = performance.now() - layoutStarted;
      onReflow(performance.now() - started, { stageMs, publishMs, layoutMs });
    } catch (error) {
      onError(error);
      return;
    }
  }
  if (configuration.animationEnabled) {
    layout ??= committedTextMetrics(entry.text);
    const maximumScrollY = Math.max(0, layout.height - viewportHeight + 24);
    scene.position.y = maximumScrollY * frame.scrollProgress;
  }
}
