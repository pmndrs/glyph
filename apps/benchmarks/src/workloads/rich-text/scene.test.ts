import { describe, expect, it } from 'vitest';

import { nextRichTextPublicationTick, richTextComposition, richTextParagraphCount, richTextSpanNames } from './scene';

const BODY = 16;

// Font-bearing span composition is exercised by the rich-text-spans conformance target with authentic loaded Fonts.
// A structural cast cannot stand in for a package-owned immutable Font and would test behavior applications cannot use.
describe('rich text composition', () => {
  it('derives every size and spacing value from the body size', () => {
    expect(richTextComposition(BODY)).toEqual({
      accentFontSize: 20,
      bodyFontSize: 16,
      emphasisFontSize: 30.4,
      letterSpacing: 5,
      nested: true,
      nestedFontSize: 12.48,
      smallCaps: true,
      tintColor: '#00c8ff',
    });
  });

  it('drops only the nested span name for the control that isolates it', () => {
    const composition = richTextComposition(BODY, { nested: false });
    expect(richTextSpanNames(composition)).not.toContain('nested');
    expect(richTextSpanNames(composition)).toHaveLength(7);
  });

  it('maps the span-density control onto a bounded paragraph stack', () => {
    expect(richTextParagraphCount(0)).toBe(1);
    expect(richTextParagraphCount(50)).toBe(4);
    expect(richTextParagraphCount(100)).toBe(6);
    expect(() => richTextParagraphCount(-1)).toThrow(RangeError);
    expect(() => richTextParagraphCount(101)).toThrow(RangeError);
  });
});

describe('rich text mutation cadence', () => {
  it('publishes the same 60 logical ticks from 60 Hz and 120 Hz rAF timestamps', () => {
    expect(collectMutationTicks(60)).toEqual(Array.from({ length: 60 }, (_, tick) => tick));
    expect(collectMutationTicks(120)).toEqual(Array.from({ length: 60 }, (_, tick) => tick));
  });

  it('publishes no ticks while animation is disabled', () => {
    expect(nextRichTextPublicationTick(false, 0, undefined)).toBeUndefined();
    expect(nextRichTextPublicationTick(false, 1_000, 12)).toBeUndefined();
  });

  it('skips duplicate ticks and jumps to the latest tick once after a delayed rAF', () => {
    expect(nextRichTextPublicationTick(true, 0, undefined)).toBe(0);
    expect(nextRichTextPublicationTick(true, 8, 0)).toBeUndefined();
    expect(nextRichTextPublicationTick(true, 100, 0)).toBe(6);
    expect(nextRichTextPublicationTick(true, 110, 6)).toBeUndefined();
  });
});

function collectMutationTicks(refreshRate: 60 | 120): readonly number[] {
  const ticks: number[] = [];
  let previousTick: number | undefined;
  for (let frame = 0; frame < refreshRate; frame += 1) {
    const elapsedMs = (frame * 1_000) / refreshRate;
    const tick = nextRichTextPublicationTick(true, elapsedMs, previousTick);
    if (tick === undefined) continue;
    ticks.push(tick);
    previousTick = tick;
  }
  return ticks;
}
