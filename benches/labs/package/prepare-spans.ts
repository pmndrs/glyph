import { bench } from '@pmndrs/labs';

import { hashParagraphLayout } from '../../src/benchmark/paragraph-layout-digest.ts';
import { createLabelsHolding, createParagraph, disposeLabels, disposeParagraph } from './fixture.ts';

// A setter may prepare its paragraph at once or only record the change, depending on the package under test. Every
// workload here is therefore timed over three spans that end at the setter, at a read of the changed texts, and at the
// frame that publishes them, so a package that moves layout out of the setter cannot show the move as a saving.

type InspectableText = ReturnType<typeof createLabelsHolding>['labels'][number];
type LabelSetOptions = NonNullable<Parameters<typeof createLabelsHolding>[1]>;

export const prepareSpans = ['setter', 'read', 'frame'] as const;
export type PrepareSpan = (typeof prepareSpans)[number];

/** Selects every three-span row: `labs @prepare-spans`, or `--suite prepare-spans`. */
export const prepareSpanTag = '@prepare-spans';

/** The frame twin of a split row keeps the row's original name. */
const splitSuffixes = { setter: ' [setter only]', read: ' [setter + read]', frame: '' } as const;

export function splitRowName(base: string, span: PrepareSpan, tags = ''): string {
  return `${base}${splitSuffixes[span]} ${tags} ${prepareSpanTag}`.replaceAll(/\s+/gu, ' ');
}

/** A workload with no earlier row: every span is named, `verb` being what precedes the read or the frame. */
export function spanRowName(base: string, span: PrepareSpan, tags = '', verb = 'setter'): string {
  const suffix = { setter: `${verb} only`, read: `${verb} + read`, frame: `${verb} + frame` }[span];
  return `${base} [${suffix}] ${tags} ${prepareSpanTag}`.replaceAll(/\s+/gu, ' ');
}

/** What a cold text holding the same content lays out and, once published, reports as committed glyphs. */
export interface ColdLayout {
  readonly layout: string;
  readonly publishedGlyphs: number;
}

/** Measurement plus every per-glyph and per-line column. Reading it prepares the paragraph, so never call it in a timed span. */
export function layoutDigest(text: InspectableText): string {
  const measurement = text.measure();
  return [
    measurement.width,
    measurement.height,
    measurement.lineCount,
    measurement.glyphCount,
    hashParagraphLayout(text.glyphs()),
  ].join(':');
}

function committedGlyphs(text: InspectableText): number | undefined {
  return text.commitState().status === 'committed' ? text.measureGlyphs()?.length : undefined;
}

/** The reference for one already published text; use it only on a text that never passed through the setter under test. */
export function publishedLayout(text: InspectableText): ColdLayout {
  const rendered = committedGlyphs(text);
  if (rendered === undefined) throw new Error('a cold text must be published before it is digested');
  return { layout: layoutDigest(text), publishedGlyphs: rendered };
}

/** One independently created, published label per entry of `texts`; none of them ever passes through a setter. */
export function coldLabelLayouts(texts: readonly string[], options: LabelSetOptions = {}): readonly ColdLayout[] {
  const cold = createLabelsHolding(texts, options);
  try {
    return cold.labels.map(publishedLayout);
  } finally {
    disposeLabels(cold);
  }
}

export function coldParagraphLayout(...parameters: Parameters<typeof createParagraph>): ColdLayout {
  const cold = createParagraph(...parameters);
  try {
    return publishedLayout(cold.paragraph);
  } finally {
    disposeParagraph(cold);
  }
}

/**
 * Throws unless a frame committed every text and published the cold glyph count. This is renderer-side evidence: a
 * layout read can prepare a paragraph the frame skipped, but only a frame publishes it.
 */
export function assertFramePublished(texts: readonly InspectableText[], expected: readonly ColdLayout[]): void {
  assertSameLength(texts, expected);
  for (const [index, text] of texts.entries()) {
    const rendered = committedGlyphs(text);
    if (rendered !== expected[index]!.publishedGlyphs) {
      throw new Error(
        `the frame left text ${String(index)} with ${String(rendered)} published glyphs; a cold text holding the same content publishes ${String(expected[index]!.publishedGlyphs)}`,
      );
    }
  }
}

/** Throws unless every text now lays out exactly as a cold text holding the same content. */
export function assertLayoutDigests(texts: readonly InspectableText[], expected: readonly ColdLayout[]): void {
  assertSameLength(texts, expected);
  for (const [index, text] of texts.entries()) {
    const actual = layoutDigest(text);
    if (actual !== expected[index]!.layout) {
      throw new Error(
        `text ${String(index)} has layout digest ${actual}; a cold text holding the same content has ${expected[index]!.layout}`,
      );
    }
  }
}

/** The untimed verification of one span: the frame's own evidence, then the layout every span must reach. */
export function assertSpanLayout(
  span: PrepareSpan,
  texts: readonly InspectableText[],
  expected: readonly ColdLayout[],
): void {
  if (span === 'frame') assertFramePublished(texts, expected);
  assertLayoutDigests(texts, expected);
}

function assertSameLength(texts: readonly InspectableText[], expected: readonly ColdLayout[]): void {
  if (texts.length !== expected.length) {
    throw new Error(`${String(texts.length)} texts cannot match ${String(expected.length)} cold layouts`);
  }
}

/** Ends a timed span after its setters: nothing, one measurement per changed text, or the publishing frame. */
export function finishSpan(span: PrepareSpan, changed: readonly InspectableText[], frame: () => void): void {
  if (span === 'read') {
    for (const text of changed) text.measure();
  } else if (span === 'frame') frame();
}

type SelfTimed = Readonly<{ manual: () => number }>;
export type SpanStep = (() => unknown) | SelfTimed;
type SpanGenerator = () => Generator<SpanStep, void, unknown>;

/**
 * A Labs step that times itself, for a workload whose state must be rebuilt before every call: `prepare` runs untimed,
 * only `timed` is measured, and Labs never batches such a step, so no timed call runs on unprepared state.
 */
export function selfTimed(prepare: () => void, timed: () => void): SelfTimed {
  return {
    manual: () => {
      prepare();
      const started = performance.now();
      timed();
      return (performance.now() - started) * 1e6;
    },
  };
}

/** Every three-span row registered by the imported bench files, for the deterministic generator check. */
export const spanRows: { readonly name: string; readonly run: SpanGenerator }[] = [];

export function spanBench(name: string, run: SpanGenerator): void {
  spanRows.push({ name, run });
  bench(name, function* () {
    return yield* run();
  });
}
