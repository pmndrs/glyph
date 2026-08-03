import { Text } from '@pmndrs/text';
import type * as THREE from 'three/webgpu';

import type { RasterConformanceSpecimen } from '../benchmark/font-fixtures';
import { LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from './shared/text-style';
import type { ComparisonWorkloadConfiguration, ComparisonWorkloadDefinition } from './contracts';
import {
  committedTextLayout,
  type ComparisonWorkloadEntry,
  type WorkloadTextFactoryContext,
} from './factory-contracts';

export const LADDER_CSS_SIZES = [
  8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256, 512, 1024,
] as const;
export const LADDER_SENTENCE = 'The quick brown fox jumps over the lazy dog.';
export const LADDER_GAP_CSS_PX = 10;
export const LADDER_INSET_CSS_PX = 20;

export interface MutableTextLadderScenePosition {
  x: number;
  y: number;
}

export const textLadderWorkload = {
  cameraKind: 'orthographic',
  contentWidth: 'none',
  create(context) {
    return createTextLadderEntries({
      dpr: context.dpr,
      font: context.font,
      raster: context.raster,
      ...(context.textLadderSpecimen === undefined ? {} : { specimen: context.textLadderSpecimen }),
      viewportHeight: context.viewportHeight,
    });
  },
  id: 'text-ladder',
  layout(entries, context) {
    layoutTextLadderEntries(entries, context.viewportWidth);
  },
  suspendsIconWindow: false,
  updateKind: () => 'retained',
} satisfies ComparisonWorkloadDefinition;

export function createTextLadderEntries(
  context: WorkloadTextFactoryContext & {
    readonly specimen?: RasterConformanceSpecimen;
    readonly viewportHeight: number;
  },
): readonly ComparisonWorkloadEntry[] {
  const specimen = context.specimen ?? { text: LADDER_SENTENCE, language: 'en', direction: 'ltr' as const };
  return ladderCssSizes(context.viewportHeight).map((fontSize) => {
    const sourceText = context.specimen === undefined ? `${fontSize} px  ${specimen.text}` : specimen.text;
    const text = new Text({
      font: context.font,
      raster: context.raster,
      rasterPixelRatio: context.dpr,
      lineHeight: LIVE_TEXT_LINE_HEIGHT,
      text: sourceText,
      fontSize,
      language: specimen.language,
      direction: specimen.direction,
      color: LIVE_TEXT_COLOR,
    });
    return { node: text, role: 'primary', sourceText, text };
  });
}

export function ladderCssSizes(viewportHeight: number): readonly number[] {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    throw new RangeError('text ladder viewport height must be positive');
  }
  return LADDER_CSS_SIZES;
}

export function textLadderScenePosition({
  animationSpeed,
  elapsedMs,
  exitEnabled,
  finalCenterY,
  finalEntryWidth,
  finalEntryX,
  viewportHeight,
  viewportWidth,
}: {
  readonly animationSpeed: number;
  readonly elapsedMs: number;
  readonly exitEnabled: boolean;
  readonly finalCenterY: number;
  readonly finalEntryWidth: number;
  readonly finalEntryX: number;
  readonly viewportHeight: number;
  readonly viewportWidth: number;
}): Readonly<{ x: number; y: number }> {
  const position: MutableTextLadderScenePosition = { x: 0, y: 0 };
  setTextLadderScenePosition(position, {
    animationSpeed,
    elapsedMs,
    exitEnabled,
    finalCenterY,
    finalEntryWidth,
    finalEntryX,
    viewportHeight,
    viewportWidth,
  });
  return position;
}

/** Updates caller-owned scene-position storage for the text-ladder render loop. */
export function setTextLadderScenePosition(
  position: MutableTextLadderScenePosition,
  {
    animationSpeed,
    elapsedMs,
    exitEnabled,
    finalCenterY,
    finalEntryWidth,
    finalEntryX,
    viewportHeight,
    viewportWidth,
  }: {
    readonly animationSpeed: number;
    readonly elapsedMs: number;
    readonly exitEnabled: boolean;
    readonly finalCenterY: number;
    readonly finalEntryWidth: number;
    readonly finalEntryX: number;
    readonly viewportHeight: number;
    readonly viewportWidth: number;
  },
): void {
  const cycle = modulo((elapsedMs / 9_000) * animationRate(animationSpeed), 1);
  const scrollProgress = smoothstep(Math.min(1, cycle / 0.52));
  const marqueeProgress = exitEnabled ? smoothstep(Math.max(0, Math.min(1, (cycle - 0.52) / 0.38))) : 0;
  const centeredScrollY = -viewportHeight / 2 - finalCenterY;
  const offscreenLeftX = -finalEntryX - finalEntryWidth - viewportWidth * 0.05;
  position.x = marqueeProgress === 0 ? 0 : offscreenLeftX * marqueeProgress;
  position.y = centeredScrollY * scrollProgress;
}

export function layoutTextLadderEntries(entries: readonly ComparisonWorkloadEntry[], viewportWidth: number): void {
  const layouts = entries.map(({ text }) => committedTextLayout(text));
  const widestLine = layouts.reduce((maximum, layout) => Math.max(maximum, layout.width), 0);
  const centeredColumnWidth = Math.min(widestLine, viewportWidth * 0.94);
  const x = Math.max(LADDER_INSET_CSS_PX, (viewportWidth - centeredColumnWidth) / 2);
  let y = LADDER_INSET_CSS_PX + 18;
  for (const [index, { text }] of entries.entries()) {
    const layout = layouts[index]!;
    text.position.set(x, -y, 0);
    y += layout.height + LADDER_GAP_CSS_PX;
  }
}

export function animateTextLadderScene(
  scene: THREE.Scene,
  entries: readonly ComparisonWorkloadEntry[],
  configuration: Pick<ComparisonWorkloadConfiguration, 'animationSpeed' | 'textLadderExitEnabled'>,
  elapsedMs: number,
  viewportWidth: number,
  viewportHeight: number,
  positionScratch: MutableTextLadderScenePosition,
): void {
  const finalEntry = entries[entries.length - 1];
  if (finalEntry === undefined) return;
  const layout = committedTextLayout(finalEntry.text);
  setTextLadderScenePosition(positionScratch, {
    animationSpeed: configuration.animationSpeed,
    elapsedMs,
    exitEnabled: configuration.textLadderExitEnabled,
    finalCenterY: finalEntry.text.position.y - layout.height / 2,
    finalEntryX: finalEntry.text.position.x,
    finalEntryWidth: layout.width,
    viewportHeight,
    viewportWidth,
  });
  scene.position.set(positionScratch.x, positionScratch.y, 0);
}

function animationRate(animationSpeed: number): number {
  return 0.25 + animationSpeed * 0.0175;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}
