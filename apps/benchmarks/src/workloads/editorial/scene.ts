import { Text } from '@pmndrs/glyph/three';
import type * as THREE from 'three/webgpu';

import type { ComparisonWorkloadConfiguration, ComparisonWorkloadDefinition } from '../comparison/contracts';
import { benchmarkContentWidth, LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from '../shared/text-style';
import {
  committedTextMetrics,
  exactWidth,
  paintColor,
  publishWorkloadTexts,
  type ComparisonWorkloadEntry,
  type WorkloadTextFactoryContext,
} from '../shared/scene-entry';

/** One editorial column: every paragraph justifies with bounded elasticity. */
export const EDITORIAL_TEXT = [
  'The pull of a justified column is older than the press that made it common. A page holds its measure, both edges true, while every line negotiates its own interior: word spaces widen and narrow inside declared bounds, and the letters lend a fraction of a unit when the words alone cannot settle the difference.',
  'Typography is the craft of endowing human language with a durable visual form. The paragraph opens with a small indent, carries its own space before and after, and asks the composer for restraint: expansion capped near a third of a space, compression never past three quarters, and the last line left to fall where it may.',
  'A tight measure is the honest test. When the column narrows, the breaker may borrow back the declared shrink to seat one more word; when it widens, capped word growth spills into hair-fine letter spacing rather than rivers. The reader should notice none of this — only that the page sits quietly.',
] as const;

const EDITORIAL_JUSTIFY = {
  minWordSpaceRatio: 0.75,
  maxWordSpaceRatio: 1.35,
  letterSpaceExpansion: 0.4,
} as const;

export const editorialWorkload = {
  animate(entries, configuration, elapsedMs, viewportWidth, viewportHeight, scene, _scratch, onError, onReflow) {
    animateEditorialEntries(entries, configuration, elapsedMs, viewportWidth, viewportHeight, scene, onError, onReflow);
  },
  applyRetainedConfiguration() {},
  batching: 'group',
  cameraKind: 'orthographic',
  contentWidth: { maximumWidth: 860 },
  create(context) {
    return createEditorialEntries({
      ...context.configuration,
      animationElapsedMs: context.animationElapsedMs,
      dpr: context.dpr,
      font: context.font,
      viewportWidth: context.viewportWidth,
    });
  },
  id: 'editorial',
  layout(entries, context) {
    layoutEditorialEntries(entries, context.viewportWidth, context.viewportHeight);
  },
  suspendsIconWindow: false,
  updateKind: () => 'retained',
} satisfies ComparisonWorkloadDefinition;

/** The animated editorial measure: one shared column width breathing slowly. */
export function editorialColumnWidth(
  configuration: Pick<ComparisonWorkloadConfiguration, 'animationSpeed' | 'layoutWidthRatio'>,
  viewportWidth: number,
  animationElapsedMs: number,
): number {
  const phase = animationElapsedMs * 0.00035 * animationRate(configuration.animationSpeed);
  const baseWidth = benchmarkContentWidth(viewportWidth, configuration.layoutWidthRatio, 860);
  return Math.max(220, baseWidth * (0.82 + Math.sin(phase) * 0.16));
}

export function createEditorialEntries(
  context: WorkloadTextFactoryContext &
    Pick<ComparisonWorkloadConfiguration, 'amount' | 'animationSpeed' | 'fontSize' | 'layoutWidthRatio'> & {
      readonly animationElapsedMs: number;
      readonly viewportWidth: number;
    },
): readonly ComparisonWorkloadEntry[] {
  const width = editorialColumnWidth(context, context.viewportWidth, context.animationElapsedMs);
  // The amount control repeats the editorial cycle: 50 keeps one full column,
  // and larger volumes stack additional justified pages onto the same measure.
  const paragraphCount = Math.max(EDITORIAL_TEXT.length, Math.round((context.amount / 50) * EDITORIAL_TEXT.length));
  const sourceTexts = Array.from(
    { length: paragraphCount },
    (_, index) => EDITORIAL_TEXT[index % EDITORIAL_TEXT.length]!,
  );
  return sourceTexts.map((sourceText, index) => {
    const text = new Text({
      font: context.font,
      rasterPixelRatio: context.dpr,
      text: sourceText,
      style: {
        fontSize: context.fontSize,
        lineHeight: LIVE_TEXT_LINE_HEIGHT,
        wordSpacing: index % EDITORIAL_TEXT.length === 1 ? context.fontSize * 0.05 : 0,
      },
      paint: { color: paintColor(LIVE_TEXT_COLOR) },
      contentBox: {
        width: exactWidth(width),
        wrap: 'word',
        align: 'justify',
        firstLineIndent: index % EDITORIAL_TEXT.length === 0 && index === 0 ? 0 : context.fontSize * 1.5,
        spaceBefore: index === 0 ? 0 : context.fontSize * 0.6,
        spaceAfter: context.fontSize * 0.4,
        justify: EDITORIAL_JUSTIFY,
        lastLine: index === sourceTexts.length - 1 ? 'justify' : 'auto',
      },
    });
    return {
      node: text,
      role: index === 0 ? 'primary' : 'secondary',
      sourceText,
      text,
      lastWidth: width,
    };
  });
}

export function animateEditorialEntries(
  entries: readonly ComparisonWorkloadEntry[],
  configuration: Pick<ComparisonWorkloadConfiguration, 'animationEnabled' | 'animationSpeed' | 'layoutWidthRatio'>,
  timestamp: number,
  viewportWidth: number,
  viewportHeight: number,
  scene: THREE.Scene,
  onError: (error: unknown) => void,
  onReflow: (duration: number) => void,
): void {
  if (!configuration.animationEnabled) return;
  const width = editorialColumnWidth(configuration, viewportWidth, timestamp);
  if (entries.every((entry) => entry.lastWidth !== undefined && Math.abs(width - entry.lastWidth) < 1)) {
    return;
  }
  const reflowStarted = performance.now();
  try {
    for (const entry of entries) {
      entry.lastWidth = width;
      entry.text.set({ contentBox: { ...entry.text.contentBox, width: exactWidth(width) } });
    }
    publishWorkloadTexts(scene, entries);
    layoutEditorialEntries(entries, viewportWidth, viewportHeight);
    onReflow(performance.now() - reflowStarted);
  } catch (error) {
    onError(error);
  }
}

/** Paragraphs stack from their measured extents: space-after is part of the block size. */
export function layoutEditorialEntries(
  entries: readonly ComparisonWorkloadEntry[],
  viewportWidth: number,
  viewportHeight: number,
): void {
  const inset = 24;
  let block = inset;
  let columnWidth = 0;
  for (const entry of entries) {
    columnWidth = Math.max(columnWidth, committedTextMetrics(entry.text).width);
  }
  const left = Math.max(inset, (viewportWidth - columnWidth) / 2);
  let totalHeight = 0;
  for (const entry of entries) {
    totalHeight += committedTextMetrics(entry.text).height;
  }
  block = Math.max(inset, (viewportHeight - totalHeight) / 2);
  for (const entry of entries) {
    const layout = committedTextMetrics(entry.text);
    entry.text.position.set(left, -block, 0);
    block += layout.height;
  }
}

function animationRate(animationSpeed: number): number {
  return 0.25 + animationSpeed * 0.0175;
}
