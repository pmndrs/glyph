import { Text } from '@pmndrs/text';

import { benchmarkIpsumText } from '../benchmark/font-fixtures';
import { benchmarkContentWidth, LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from '../renderer/live-text-style';
import type { ComparisonWorkloadConfiguration, ComparisonWorkloadDefinition } from './contracts';
import type { ComparisonWorkloadEntry, WorkloadTextFactoryContext } from './factory-contracts';

export const paragraphStressWorkload = {
  cameraKind: 'orthographic',
  contentWidth: {},
  id: 'paragraph-stress',
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
