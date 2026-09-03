import { describe, expect, it } from 'vitest';

import {
  richTextComposition,
  richTextParagraphCount,
  richTextSpanNames,
} from './scene';

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
