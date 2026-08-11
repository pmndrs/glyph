import type { AnyRasterTechnique, LoadedFont } from '@pmndrs/text';
import { describe, expect, it } from 'vitest';

import {
  RICH_TEXT_ACCENT_COLOR,
  RICH_TEXT_SMALL_CAPS_FEATURE,
  RICH_TEXT_SPANS,
  assertRichTextSpans,
  richTextComposition,
  richTextLiteral,
  richTextParagraphCount,
  richTextSpanNames,
  type RichTextCompanionFonts,
} from './scene';

/**
 * `span()` distinguishes a font selection from a style by structure alone, and composing a literal never touches a
 * font's raster data. Stubs therefore exercise the real composition path without a runtime, a shaper, or a fixture
 * load — which is what keeps this guard on the authored ranges cheap enough to run beside the rest of the unit suite.
 */
const companionFonts = {
  emphasis: { technique: 'emphasis' } as unknown as LoadedFont<AnyRasterTechnique>,
  foreign: { technique: 'foreign' } as unknown as LoadedFont<AnyRasterTechnique>,
} satisfies RichTextCompanionFonts;

const BODY = 16;

describe('rich text composition', () => {
  it('composes every authored span at the exact range the evidence reads back through', () => {
    const composition = richTextComposition(BODY);
    const literal = richTextLiteral(companionFonts, composition);

    expect(literal.text).toMatchInlineSnapshot(
      `"Early next century Tyrell advanced replicant design past the NEXUS phase: identical to a human, almost, filed as देवनागरी — a being virtually indistinguishable from its maker."`,
    );
    expect(() => assertRichTextSpans(literal, composition)).not.toThrow();
    expect(literal.spans.map(({ start, end }) => [start, end])).toEqual(
      RICH_TEXT_SPANS.map(({ start, end }) => [start, end]),
    );
    const styledSpans = literal.spans.map((entry) => entry.style ?? {});
    expect(styledSpans.some((style) => style.decoration?.underline === true)).toBe(true);
    expect(styledSpans.some((style) => style.decoration?.lineThrough === true)).toBe(true);
    expect(RICH_TEXT_SPANS.map(({ name, start, end }) => [name, literal.text.slice(start, end)])).toEqual([
      ['properNoun', 'Tyrell'],
      ['tracked', 'NEXUS'],
      ['emphasis', 'identical'],
      ['face', 'almost'],
      ['foreign', 'देवनागरी'],
      ['accent', 'a being virtually indistinguishable'],
      ['nested', 'virtually'],
      ['tint', 'its'],
    ]);
  });

  it('carries shaping data rather than paint alone on the spans that must reach the shaper', () => {
    const literal = richTextLiteral(companionFonts, richTextComposition(BODY));
    const [properNoun, tracked, emphasis, face, foreign, accent, nested, tint] = literal.spans;

    expect(properNoun?.font).toBe(companionFonts.emphasis);
    expect(properNoun?.style).toEqual({ features: [{ tag: RICH_TEXT_SMALL_CAPS_FEATURE }] });
    expect(tracked?.style).toEqual({ letterSpacing: BODY * 0.3125 });
    expect(emphasis?.style).toEqual({ decoration: { underline: true }, fontSize: BODY * 1.9 });
    expect(face?.font).toBe(companionFonts.emphasis);
    expect(foreign?.font).toBe(companionFonts.foreign);
    expect(accent?.paint).toEqual({ color: RICH_TEXT_ACCENT_COLOR });
    expect(accent?.style).toEqual({ fontSize: BODY * 1.25 });
    // The nested span states a size and no paint, so it must inherit the enclosing paint rather than restate it.
    expect(nested?.style).toEqual({ fontSize: BODY * 0.78 });
    expect(nested?.paint).toBeUndefined();
    expect(nested?.font).toBeUndefined();
    expect(tint?.paint).toEqual({ color: richTextComposition(BODY).tintColor });
    expect(tint?.font).toBeUndefined();
  });

  it('drops only the nesting for the control that isolates it, keeping the paragraph text identical', () => {
    const composition = richTextComposition(BODY, { nested: false });
    const literal = richTextLiteral(companionFonts, composition);

    expect(literal.text).toBe(richTextLiteral(companionFonts, richTextComposition(BODY)).text);
    expect(richTextSpanNames(composition)).not.toContain('nested');
    expect(() => assertRichTextSpans(literal, composition)).not.toThrow();
    expect(literal.spans).toHaveLength(RICH_TEXT_SPANS.length - 1);
  });

  it('maps the span-density control onto a bounded paragraph stack', () => {
    expect(richTextParagraphCount(0)).toBe(1);
    expect(richTextParagraphCount(50)).toBe(4);
    expect(richTextParagraphCount(100)).toBe(6);
    expect(() => richTextParagraphCount(-1)).toThrow(RangeError);
    expect(() => richTextParagraphCount(101)).toThrow(RangeError);
  });
});
