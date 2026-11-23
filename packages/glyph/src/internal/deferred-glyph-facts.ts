import type { LayoutBox, ParagraphLayoutSummary, ParagraphLineMetrics } from '../layout.js';

/**
 * The positioned facts of one measurement: what a summary-only read leaves out because the engine answered it
 * from flow layout and left positioning owed.
 */
export interface GlyphFacts {
  readonly glyphCount: number;
  readonly missingGlyphCount: number;
  readonly inkBounds: LayoutBox | undefined;
  readonly lines: readonly LineGlyphFacts[];
}

export interface LineGlyphFacts {
  readonly glyphStart: number;
  readonly glyphCount: number;
  readonly inkBounds: LayoutBox | undefined;
}

/** The eager part of a summary whose glyph facts are deferred. */
export type MeasuredSummaryFields = Omit<
  ParagraphLayoutSummary,
  'glyphCount' | 'missingGlyphCount' | 'inkBounds' | 'lines'
>;
export type MeasuredLineFields = Omit<ParagraphLineMetrics, 'glyphStart' | 'glyphCount' | 'inkBounds'>;

/**
 * The glyph facts of one summary-only measurement, computed on first read.
 *
 * A summary answers for the text as it was measured. Its owner binds a resolver that positions the measured
 * preparation on demand, and resolves every outstanding measurement of a paragraph before the engine prepares that
 * paragraph again, so a later read of these facts never sees a newer preparation. Once resolved the facts are plain
 * data and the resolver, with everything it reached, is released; the engine keeps no generation for them.
 */
export class DeferredGlyphFacts {
  #resolver: (() => GlyphFacts) | undefined;
  #facts: GlyphFacts | undefined;
  #lost: Error | undefined;

  get pending(): boolean {
    return this.#facts === undefined && this.#lost === undefined;
  }

  /** Called by the owner when it adopts the summary. */
  bind(resolver: () => GlyphFacts): void {
    if (this.pending) this.#resolver = resolver;
  }

  /** Fills the facts from a positioned measurement of the same preparation. */
  settle(facts: GlyphFacts): void {
    if (!this.pending) return;
    this.#facts = facts;
    this.#resolver = undefined;
  }

  /** Positions now, through the bound resolver, if nothing has filled the facts yet. */
  resolve(): GlyphFacts {
    if (this.#facts !== undefined) return this.#facts;
    if (this.#lost !== undefined) throw this.#lost;
    const resolver = this.#resolver;
    if (resolver === undefined) throw new Error('a deferred layout summary was read before its text adopted it');
    this.settle(resolver());
    return this.#facts!;
  }

  /**
   * Records that the preparation these facts describe no longer exists and cannot be positioned. Reached only when
   * an engine failure discarded the root before anything read the facts.
   */
  lose(error: Error): void {
    if (!this.pending) return;
    this.#lost = error;
    this.#resolver = undefined;
  }
}

/** The positioned facts a full summary carries. */
export function glyphFactsOf(summary: ParagraphLayoutSummary): GlyphFacts {
  return {
    glyphCount: summary.glyphCount,
    missingGlyphCount: summary.missingGlyphCount,
    inkBounds: summary.inkBounds,
    lines: summary.lines.map((line) => ({
      glyphStart: line.glyphStart,
      glyphCount: line.glyphCount,
      inkBounds: line.inkBounds,
    })),
  };
}

const deferredFactsOfSummary = new WeakMap<ParagraphLayoutSummary, DeferredGlyphFacts>();

/** The deferred facts behind a summary, or `undefined` for a summary that carries its facts. */
export function deferredGlyphFacts(summary: ParagraphLayoutSummary): DeferredGlyphFacts | undefined {
  return deferredFactsOfSummary.get(summary);
}

const deferredLines = new WeakSet<ParagraphLineMetrics>();

function isDeferredLine(line: MeasuredLineFields | ParagraphLineMetrics): line is ParagraphLineMetrics {
  return deferredLines.has(line as ParagraphLineMetrics);
}

/** Line facts share one accessor shape: the getters read the line's facts through `this`. */
const lineFactsOwner = new WeakMap<object, DeferredGlyphFacts>();

function lineFacts(line: object): LineGlyphFacts {
  const facts = lineFactsOwner.get(line)!;
  return facts.resolve().lines[(line as ParagraphLineMetrics).index]!;
}

const lineFactDescriptors: PropertyDescriptorMap = {
  glyphStart: {
    enumerable: true,
    get(this: object) {
      return lineFacts(this).glyphStart;
    },
  },
  glyphCount: {
    enumerable: true,
    get(this: object) {
      return lineFacts(this).glyphCount;
    },
  },
  inkBounds: {
    enumerable: true,
    get(this: object) {
      return lineFacts(this).inkBounds;
    },
  },
};

function deferredLine(fields: MeasuredLineFields, facts: DeferredGlyphFacts): ParagraphLineMetrics {
  // The eager fields are the reader's own object; the deferred ones are shared accessors on it.
  const line = Object.defineProperties(fields, lineFactDescriptors) as ParagraphLineMetrics;
  lineFactsOwner.set(line, facts);
  Object.freeze(line);
  deferredLines.add(line);
  return line;
}

/**
 * A summary whose glyph count, missing-glyph count, ink and line glyph spans are computed on first read. Reading one
 * of them positions the measured preparation if nothing has yet; every other field is the flow's answer.
 */
export function deferredSummary(
  fields: MeasuredSummaryFields,
  lines: readonly (MeasuredLineFields | ParagraphLineMetrics)[],
  facts: DeferredGlyphFacts,
): ParagraphLayoutSummary {
  const summary: ParagraphLayoutSummary = Object.freeze({
    ...fields,
    get glyphCount(): number {
      return facts.resolve().glyphCount;
    },
    get missingGlyphCount(): number {
      return facts.resolve().missingGlyphCount;
    },
    get inkBounds(): LayoutBox | undefined {
      return facts.resolve().inkBounds;
    },
    // A rebuilt summary keeps its line array, as a spread copy of an eager summary does.
    lines:
      Object.isFrozen(lines) && lines.every(isDeferredLine)
        ? (lines as readonly ParagraphLineMetrics[])
        : Object.freeze(lines.map((line) => (isDeferredLine(line) ? line : deferredLine(line, facts)))),
  });
  deferredFactsOfSummary.set(summary, facts);
  return summary;
}

/**
 * Rebuilds a summary with replaced eager fields, keeping deferred facts deferred: spreading a deferred summary would
 * read its facts and position the paragraph.
 */
export function withSummaryFields(
  summary: ParagraphLayoutSummary,
  fields: Partial<MeasuredSummaryFields>,
): ParagraphLayoutSummary {
  const facts = deferredFactsOfSummary.get(summary);
  if (facts === undefined) return Object.freeze({ ...summary, ...fields });
  const eager: Record<string, unknown> = {};
  for (const key of Object.keys(summary) as (keyof ParagraphLayoutSummary)[]) {
    if (key === 'glyphCount' || key === 'missingGlyphCount' || key === 'inkBounds' || key === 'lines') continue;
    eager[key] = summary[key];
  }
  return deferredSummary({ ...(eager as MeasuredSummaryFields), ...fields }, summary.lines, facts);
}
