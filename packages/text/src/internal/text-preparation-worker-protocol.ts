import type { FontHandle } from '../identity.js';
import type { ParagraphLayout } from '../layout.js';
import type { RuntimeShaperFontData } from '../shaper.js';
import type { WorkerParagraphLayoutInput } from '../paragraph-batch.js';

export interface TextPreparationRequestV1 {
  readonly type: 'pmndrs-text-prepare-v1';
  readonly id: number;
  readonly fonts: readonly RuntimeShaperFontData[];
  readonly paragraphs: readonly {
    readonly batch: number;
    readonly paragraph: number;
    readonly input: WorkerParagraphLayoutInput;
  }[];
}

export interface TextPreparationCancelV1 {
  readonly type: 'pmndrs-text-cancel-v1';
  readonly id: number;
}

export interface TextPreparationProgressV1 {
  readonly type: 'pmndrs-text-progress-v1';
  readonly id: number;
  readonly preparedParagraphs: number;
  readonly totalParagraphs: number;
  readonly stagedGlyphs: number;
}

export interface TextPreparationSuccessV1 {
  readonly type: 'pmndrs-text-success-v1';
  readonly id: number;
  readonly layouts: readonly {
    readonly batch: number;
    readonly paragraph: number;
    readonly layout: ParagraphLayout;
  }[];
}

export interface TextPreparationFailureV1 {
  readonly type: 'pmndrs-text-failure-v1';
  readonly id: number;
  readonly error: Readonly<{ name: string; message: string; stack?: string }>;
}

export type TextPreparationWorkerMessageV1 = TextPreparationRequestV1 | TextPreparationCancelV1;
export type TextPreparationWorkerResultV1 =
  | TextPreparationProgressV1
  | TextPreparationSuccessV1
  | TextPreparationFailureV1;

export function isTextPreparationWorkerResultV1(value: unknown): value is TextPreparationWorkerResultV1 {
  if (typeof value !== 'object' || value === null || !('type' in value) || !('id' in value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!nonnegativeInteger(candidate.id)) return false;
  if (candidate.type === 'pmndrs-text-progress-v1')
    return (
      nonnegativeInteger(candidate.preparedParagraphs) &&
      nonnegativeInteger(candidate.totalParagraphs) &&
      nonnegativeInteger(candidate.stagedGlyphs) &&
      candidate.preparedParagraphs <= candidate.totalParagraphs
    );
  if (candidate.type === 'pmndrs-text-failure-v1') {
    if (typeof candidate.error !== 'object' || candidate.error === null) return false;
    const error = candidate.error as Record<string, unknown>;
    return (
      typeof error.name === 'string' &&
      typeof error.message === 'string' &&
      (error.stack === undefined || typeof error.stack === 'string')
    );
  }
  if (candidate.type !== 'pmndrs-text-success-v1' || !Array.isArray(candidate.layouts)) return false;
  return candidate.layouts.every((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const layout = entry as Record<string, unknown>;
    return nonnegativeInteger(layout.batch) && nonnegativeInteger(layout.paragraph) && isParagraphLayout(layout.layout);
  });
}

export function fontHandle(value: number): FontHandle {
  return value as FontHandle;
}

function isParagraphLayout(value: unknown): value is ParagraphLayout {
  if (typeof value !== 'object' || value === null) return false;
  const layout = value as Record<string, unknown>;
  for (const field of ['width', 'height', 'contentWidth', 'contentHeight', 'firstBaseline', 'lastBaseline'])
    if (typeof layout[field] !== 'number' || !Number.isFinite(layout[field])) return false;
  if (typeof layout.overflowed !== 'boolean') return false;
  return (
    layout.fontHandles instanceof Uint32Array &&
    layout.glyphFontSlots instanceof Uint16Array &&
    layout.glyphIds instanceof Uint16Array &&
    layout.clusters instanceof Uint32Array &&
    layout.glyphFontSizes instanceof Float32Array &&
    layout.x instanceof Float32Array &&
    layout.y instanceof Float32Array &&
    layout.glyphFlags instanceof Uint16Array &&
    layout.lineTextStarts instanceof Uint32Array &&
    layout.lineTextEnds instanceof Uint32Array &&
    layout.lineGlyphStarts instanceof Uint32Array &&
    layout.lineGlyphCounts instanceof Uint32Array &&
    layout.lineBaselines instanceof Float32Array &&
    layout.lineAdvances instanceof Float32Array
  );
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
