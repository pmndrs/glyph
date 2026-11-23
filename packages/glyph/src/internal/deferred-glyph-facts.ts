import type { LayoutBox, ParagraphLayoutSummary, ParagraphLineMetrics } from '../layout.js';

export interface LineGlyphFacts {
  readonly glyphStart: number;
  readonly glyphCount: number;
  readonly inkBounds: LayoutBox | undefined;
}

/**
 * The positioned facts of one measurement: what a summary-only read leaves out because the engine answered it
 * from flow layout and left positioning owed. The paragraph totals are decoded with the record; the per-line facts,
 * which only a reader of `lines` needs, are decoded on first demand.
 */
export class GlyphFacts {
  readonly glyphCount: number;
  readonly missingGlyphCount: number;
  readonly inkBounds: LayoutBox | undefined;
  #lines: readonly LineGlyphFacts[] | (() => readonly LineGlyphFacts[]);

  /** `lines`: the per-line facts, or how to decode them on first demand. */
  constructor(
    glyphCount: number,
    missingGlyphCount: number,
    inkBounds: LayoutBox | undefined,
    lines: readonly LineGlyphFacts[] | (() => readonly LineGlyphFacts[]),
  ) {
    this.glyphCount = glyphCount;
    this.missingGlyphCount = missingGlyphCount;
    this.inkBounds = inkBounds;
    this.#lines = lines;
  }

  get lines(): readonly LineGlyphFacts[] {
    if (typeof this.#lines === 'function') this.#lines = this.#lines();
    return this.#lines;
  }
}

/** The eager part of a summary whose glyph facts are deferred. */
export type MeasuredSummaryFields = Omit<
  ParagraphLayoutSummary,
  'glyphCount' | 'missingGlyphCount' | 'inkBounds' | 'lines'
>;
export type MeasuredLineFields = Omit<ParagraphLineMetrics, 'glyphStart' | 'glyphCount' | 'inkBounds'>;

/**
 * The glyph facts of one measurement read, computed on first read when the read left them deferred.
 *
 * A summary answers for the text as it was measured. Its owner binds a resolver that positions the measured
 * preparation on demand, and resolves every outstanding measurement of a paragraph before the engine prepares that
 * paragraph again, so a later read of these facts never sees a newer preparation. Once resolved the facts are plain
 * data and the resolver, with everything it reached, is released; the engine keeps no generation for them.
 *
 * It also records whether the caller read any of them through the summary: the owner positions the next read up
 * front for a caller that does, so that caller pays one engine call per read rather than two.
 */
export class DeferredGlyphFacts {
  #resolver: (() => GlyphFacts) | undefined;
  #facts: GlyphFacts | undefined;
  #lost: Error | undefined;
  #read = false;

  /** Facts a read already carried: nothing is deferred, but reads of them are still observed. */
  static answered(facts: GlyphFacts): DeferredGlyphFacts {
    const answered = new DeferredGlyphFacts();
    answered.#facts = facts;
    return answered;
  }

  get pending(): boolean {
    return this.#facts === undefined && this.#lost === undefined;
  }

  /** Whether a caller read a glyph fact through the summary. */
  get read(): boolean {
    return this.#read;
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

  /** The facts as a caller's read of the summary sees them. */
  readBySummary(): GlyphFacts {
    this.#read = true;
    return this.resolve();
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

/** The line metrics of one summary, decoded on the first read of its `lines`. */
export class SummaryLines {
  #lines: readonly ParagraphLineMetrics[] | undefined;
  #fields: readonly MeasuredLineFields[] | (() => readonly MeasuredLineFields[]) | undefined;

  /** `fields`: the lines' metrics, or how to decode them on first demand. */
  constructor(fields: readonly MeasuredLineFields[] | (() => readonly MeasuredLineFields[])) {
    this.#fields = fields;
  }

  /** The lines, with facts as plain data once known and as accessors while they are still owed. */
  materialize(facts: DeferredGlyphFacts): readonly ParagraphLineMetrics[] {
    if (this.#lines !== undefined) return this.#lines;
    const fields = typeof this.#fields === 'function' ? this.#fields() : this.#fields!;
    this.#fields = undefined;
    if (facts.pending) {
      this.#lines = Object.freeze(fields.map((line) => deferredLine(line, facts)));
    } else {
      const answered = facts.resolve().lines;
      this.#lines = Object.freeze(fields.map((line, index) => Object.freeze({ ...line, ...answered[index]! })));
    }
    return this.#lines;
  }
}

/** The positioned facts a full summary carries. */
export function glyphFactsOf(summary: ParagraphLayoutSummary): GlyphFacts {
  const deferred = deferredSummaries.get(summary);
  if (deferred !== undefined) return deferred.facts.resolve();
  return new GlyphFacts(summary.glyphCount, summary.missingGlyphCount, summary.inkBounds, () =>
    summary.lines.map((line) => ({
      glyphStart: line.glyphStart,
      glyphCount: line.glyphCount,
      inkBounds: line.inkBounds,
    })),
  );
}

interface DeferredSummaryParts {
  readonly facts: DeferredGlyphFacts;
  readonly lines: SummaryLines;
}

const deferredSummaries = new WeakMap<ParagraphLayoutSummary, DeferredSummaryParts>();

/** The facts behind a summary a measurement read produced, or `undefined` for a summary of plain data. */
export function deferredGlyphFacts(summary: ParagraphLayoutSummary): DeferredGlyphFacts | undefined {
  return deferredSummaries.get(summary)?.facts;
}

/** Line facts share one accessor shape: the getters read the line's facts through `this`. */
const lineFactsOwner = new WeakMap<object, DeferredGlyphFacts>();

function lineFacts(line: object): LineGlyphFacts {
  const facts = lineFactsOwner.get(line)!;
  return facts.readBySummary().lines[(line as ParagraphLineMetrics).index]!;
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
  return Object.freeze(line);
}

/**
 * A summary whose glyph count, missing-glyph count, ink and lines are computed on first read. Reading a glyph fact
 * positions the measured preparation if nothing has yet; every other field is the flow's answer.
 */
export function deferredSummary(
  fields: MeasuredSummaryFields,
  lines: SummaryLines,
  facts: DeferredGlyphFacts,
): ParagraphLayoutSummary {
  const summary: ParagraphLayoutSummary = Object.freeze({
    ...fields,
    get glyphCount(): number {
      return facts.readBySummary().glyphCount;
    },
    get missingGlyphCount(): number {
      return facts.readBySummary().missingGlyphCount;
    },
    get inkBounds(): LayoutBox | undefined {
      return facts.readBySummary().inkBounds;
    },
    // A rebuilt summary shares its line array, as a spread copy of an eager summary does.
    get lines(): readonly ParagraphLineMetrics[] {
      return lines.materialize(facts);
    },
  });
  deferredSummaries.set(summary, { facts, lines });
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
  const parts = deferredSummaries.get(summary);
  if (parts === undefined) return Object.freeze({ ...summary, ...fields });
  const eager: Record<string, unknown> = {};
  for (const key of Object.keys(summary) as (keyof ParagraphLayoutSummary)[]) {
    if (key === 'glyphCount' || key === 'missingGlyphCount' || key === 'inkBounds' || key === 'lines') continue;
    eager[key] = summary[key];
  }
  return deferredSummary({ ...(eager as MeasuredSummaryFields), ...fields }, parts.lines, parts.facts);
}
