import { Rules } from '@cto.af/linebreak';
import { graphemeSegments } from 'unicode-segmenter/grapheme';
import {
  commonScript,
  inheritedScript,
  scriptExtensionOffsets,
  scriptExtensionRanges,
  scriptExtensionTags,
  scriptRanges,
  unicodeDataVersion,
  unknownScript,
} from '../generated/unicode-script-data.js';

export const UNICODE_VERSION: string = unicodeDataVersion;

export interface UnicodeBreak {
  readonly position: number;
  readonly required: boolean;
}

export interface ScriptItem {
  readonly start: number;
  readonly end: number;
  readonly script: string;
}

export interface UnicodeTextAnalysis {
  readonly graphemeBoundaries: Uint32Array;
  readonly lineBreaks: readonly UnicodeBreak[];
  readonly scriptItems: readonly ScriptItem[];
}

/**
 * Grapheme scripts in a structure of arrays, with candidate script extensions in one flat run per grapheme addressed by
 * `candidateOffsets`. An object per grapheme carrying its own candidate array allocated three times per grapheme of the
 * paragraph, which is the dominant cost of analysing text that has changed.
 */
interface GraphemeScripts {
  readonly count: number;
  /** Grapheme `index` spans `[boundaries[index], boundaries[index + 1])`. */
  readonly boundaries: Uint32Array;
  readonly scripts: Uint32Array;
  readonly candidateOffsets: Uint32Array;
  readonly candidateTags: Uint32Array;
}

const lineBreakRules = new Rules();

export function analyzeUnicodeText(text: string): UnicodeTextAnalysis {
  assertWellFormed(text);
  // One segmentation pass. Grapheme boundaries and script itemization both walk the same segmenter, and walking it
  // twice segments the whole paragraph twice for two views of one answer.
  const boundaries = segmentGraphemes(text);
  return {
    graphemeBoundaries: boundaries,
    lineBreaks: findLineBreaks(text),
    scriptItems: itemizeSegmentedScripts(text, boundaries),
  };
}

export function findGraphemeBoundaries(text: string): Uint32Array {
  assertWellFormed(text);
  return segmentGraphemes(text);
}

export function findLineBreaks(text: string): readonly UnicodeBreak[] {
  assertWellFormed(text);
  // One pass. Spreading the iterator and mapping it built the whole break list twice to narrow each entry to two
  // fields.
  const breaks: UnicodeBreak[] = [];
  for (const entry of lineBreakRules.breaks(text)) breaks.push({ position: entry.position, required: entry.required });
  return breaks;
}

export function itemizeScripts(text: string): readonly ScriptItem[] {
  assertWellFormed(text);
  return itemizeSegmentedScripts(text, segmentGraphemes(text));
}

function segmentGraphemes(text: string): Uint32Array {
  // A grapheme is never shorter than one code unit, so the text length bounds the boundary count and the result is
  // sliced to what was written. Accumulating into a plain array and converting copied every boundary twice.
  let boundaries = new Uint32Array(text.length + 1);
  let count = 1;
  for (const segment of graphemeSegments(text)) {
    if (count === boundaries.length) {
      const grown = new Uint32Array(boundaries.length * 2);
      grown.set(boundaries);
      boundaries = grown;
    }
    boundaries[count] = segment.index + segment.segment.length;
    count += 1;
  }
  return boundaries.subarray(0, count);
}

function itemizeSegmentedScripts(text: string, boundaries: Uint32Array): readonly ScriptItem[] {
  const graphemes = resolveGraphemeScripts(text, boundaries);
  resolveNeutralScripts(graphemes);
  const scriptItems: ScriptItem[] = [];
  let itemStart = 0;
  let itemEnd = 0;
  let itemScript = 0;
  let open = false;
  for (let index = 0; index < graphemes.count; index += 1) {
    const start = boundaries[index] ?? 0;
    const end = boundaries[index + 1] ?? 0;
    const script = graphemes.scripts[index] ?? commonScript;
    // Merging compares the script as its numeric identity, so the tag string is built once per item instead of once
    // per grapheme purely to be compared and discarded.
    if (open && itemEnd === start && itemScript === script) {
      itemEnd = end;
      continue;
    }
    if (open) scriptItems.push({ start: itemStart, end: itemEnd, script: uint32ToTag(itemScript) });
    itemStart = start;
    itemEnd = end;
    itemScript = script;
    open = true;
  }
  if (open) scriptItems.push({ start: itemStart, end: itemEnd, script: uint32ToTag(itemScript) });
  return scriptItems;
}

export function scriptForCodePoint(codePoint: number): string {
  assertScalar(codePoint);
  return uint32ToTag(lookupTriple(scriptRanges, codePoint));
}

export function scriptsForCodePoint(codePoint: number): readonly string[] {
  assertScalar(codePoint);
  const setIndex = lookupTriple(scriptExtensionRanges, codePoint);
  const start = scriptExtensionOffsets[setIndex];
  const end = scriptExtensionOffsets[setIndex + 1];
  if (start === undefined || end === undefined) throw new Error('invalid generated script set');
  const scripts = [];
  for (let index = start; index < end; index += 1) {
    const tag = scriptExtensionTags[index];
    if (tag === undefined) throw new Error('invalid generated script tag');
    scripts.push(uint32ToTag(tag));
  }
  return scripts;
}

/**
 * Resolves one script per grapheme, plus the candidate extensions a neutral grapheme may adopt from its neighbours.
 *
 * The previous form received a fresh substring per grapheme, iterated it as strings so every scalar allocated another,
 * and materialized an array for every code point's script extensions and again for the non-neutral filter. This reads
 * the source text by index and intersects candidates in one reused scratch buffer, so an ASCII grapheme — the common
 * case by a wide margin — allocates nothing at all.
 */
function resolveGraphemeScripts(text: string, boundaries: Uint32Array): GraphemeScripts {
  const count = Math.max(0, boundaries.length - 1);
  const scripts = new Uint32Array(count);
  const candidateOffsets = new Uint32Array(count + 1);
  const collected: number[] = [];
  for (let grapheme = 0; grapheme < count; grapheme += 1) {
    const start = boundaries[grapheme] ?? 0;
    const end = boundaries[grapheme + 1] ?? 0;
    let preferred = commonScript;
    let intersected = false;
    let candidateLength = 0;
    for (let index = start; index < end; ) {
      const codePoint = text.codePointAt(index);
      if (codePoint === undefined) break;
      index += codePoint > 0xffff ? 2 : 1;
      const primary = lookupTriple(scriptRanges, codePoint);
      if (!isNeutralScript(primary) && preferred === commonScript) preferred = primary;
      const setIndex = lookupTriple(scriptExtensionRanges, codePoint);
      const extensionStart = scriptExtensionOffsets[setIndex];
      const extensionEnd = scriptExtensionOffsets[setIndex + 1];
      if (extensionStart === undefined || extensionEnd === undefined) {
        throw new Error('invalid generated script set');
      }
      let extensions = 0;
      for (let entry = extensionStart; entry < extensionEnd; entry += 1) {
        if (!isNeutralScript(scriptExtensionTags[entry] ?? unknownScript)) extensions += 1;
      }
      if (extensions === 0) continue;
      if (!intersected) {
        intersected = true;
        for (let entry = extensionStart; entry < extensionEnd; entry += 1) {
          const tag = scriptExtensionTags[entry] ?? unknownScript;
          if (!isNeutralScript(tag)) scratchCandidates[candidateLength++] = tag;
        }
        continue;
      }
      let retained = 0;
      for (let candidate = 0; candidate < candidateLength; candidate += 1) {
        const tag = scratchCandidates[candidate] ?? unknownScript;
        if (extensionsInclude(extensionStart, extensionEnd, tag)) scratchCandidates[retained++] = tag;
      }
      candidateLength = retained;
    }
    scripts[grapheme] = preferred;
    // A grapheme whose candidates already admit its own script needs none recorded, matching the previous empty result.
    if (intersected && candidateLength > 0 && !includesCandidate(scratchCandidates, candidateLength, preferred)) {
      for (let candidate = 0; candidate < candidateLength; candidate += 1) {
        collected.push(scratchCandidates[candidate] ?? unknownScript);
      }
    }
    candidateOffsets[grapheme + 1] = collected.length;
  }
  return { count, boundaries, scripts, candidateOffsets, candidateTags: Uint32Array.from(collected) };
}

/** Reused across graphemes; bounded by the largest generated script-extension set, and never escapes this module. */
const scratchCandidates: number[] = [];

function extensionsInclude(start: number, end: number, tag: number): boolean {
  for (let entry = start; entry < end; entry += 1) if (scriptExtensionTags[entry] === tag) return true;
  return false;
}

function includesCandidate(candidates: readonly number[], length: number, tag: number): boolean {
  for (let index = 0; index < length; index += 1) if (candidates[index] === tag) return true;
  return false;
}

function resolveNeutralScripts(graphemes: GraphemeScripts): void {
  let previous = commonScript;
  for (let index = 0; index < graphemes.count; index += 1) {
    const script = graphemes.scripts[index] ?? commonScript;
    if (isNeutralScript(script)) {
      if (acceptsContext(graphemes, index, previous)) graphemes.scripts[index] = previous;
    } else {
      previous = script;
    }
  }
  let next = commonScript;
  for (let index = graphemes.count - 1; index >= 0; index -= 1) {
    const script = graphemes.scripts[index] ?? commonScript;
    if (isNeutralScript(script)) {
      if (acceptsContext(graphemes, index, next)) graphemes.scripts[index] = next;
    } else {
      next = script;
    }
  }
}

function acceptsContext(graphemes: GraphemeScripts, index: number, script: number): boolean {
  if (isNeutralScript(script)) return false;
  const start = graphemes.candidateOffsets[index] ?? 0;
  const end = graphemes.candidateOffsets[index + 1] ?? 0;
  if (end === start) return true;
  for (let entry = start; entry < end; entry += 1) if (graphemes.candidateTags[entry] === script) return true;
  return false;
}

function extensionSet(codePoint: number): number[] {
  const setIndex = lookupTriple(scriptExtensionRanges, codePoint);
  const start = scriptExtensionOffsets[setIndex];
  const end = scriptExtensionOffsets[setIndex + 1];
  if (start === undefined || end === undefined) throw new Error('invalid generated script set');
  return Array.from(scriptExtensionTags.subarray(start, end));
}

function lookupTriple(ranges: Uint32Array, codePoint: number): number {
  let low = 0;
  let high = ranges.length / 3 - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const offset = middle * 3;
    const start = ranges[offset];
    const end = ranges[offset + 1];
    const value = ranges[offset + 2];
    if (start === undefined || end === undefined || value === undefined) break;
    if (codePoint < start) high = middle - 1;
    else if (codePoint >= end) low = middle + 1;
    else return value;
  }
  throw new RangeError(`Unicode scalar U+${codePoint.toString(16).toUpperCase()} is not classified`);
}

function isNeutralScript(script: number): boolean {
  return script === commonScript || script === inheritedScript || script === unknownScript;
}

function uint32ToTag(value: number): string {
  return String.fromCharCode(value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function assertScalar(codePoint: number): void {
  if (
    !Number.isInteger(codePoint) ||
    codePoint < 0 ||
    codePoint > 0x10_ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    throw new RangeError('code point must be a Unicode scalar value');
  }
}

function assertWellFormed(text: string): void {
  if (!text.isWellFormed()) throw new RangeError('paragraph text must be well-formed UTF-16');
}
