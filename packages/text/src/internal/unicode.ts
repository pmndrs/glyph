import { Rules } from '@cto.af/linebreak'
import { graphemeSegments } from 'unicode-segmenter/grapheme'
import {
  commonScript,
  inheritedScript,
  scriptExtensionOffsets,
  scriptExtensionRanges,
  scriptExtensionTags,
  scriptRanges,
  unicodeDataVersion,
  unknownScript,
} from '../generated/unicode-script-data.js'

export const UNICODE_VERSION: string = unicodeDataVersion

export interface UnicodeBreak {
  readonly position: number
  readonly required: boolean
}

export interface ScriptItem {
  readonly start: number
  readonly end: number
  readonly script: string
}

export interface UnicodeTextAnalysis {
  readonly graphemeBoundaries: Uint32Array
  readonly lineBreaks: readonly UnicodeBreak[]
  readonly scriptItems: readonly ScriptItem[]
}

interface GraphemeScript {
  readonly start: number
  readonly end: number
  script: number
}

const lineBreakRules = new Rules()

export function analyzeUnicodeText(text: string): UnicodeTextAnalysis {
  assertWellFormed(text)

  return {
    graphemeBoundaries: findGraphemeBoundaries(text),
    lineBreaks: findLineBreaks(text),
    scriptItems: itemizeScripts(text),
  }
}

export function findGraphemeBoundaries(text: string): Uint32Array {
  assertWellFormed(text)
  const boundaries = [0]
  for (const segment of graphemeSegments(text)) boundaries.push(segment.index + segment.segment.length)
  return Uint32Array.from(boundaries)
}

export function findLineBreaks(text: string): readonly UnicodeBreak[] {
  assertWellFormed(text)
  return [...lineBreakRules.breaks(text)].map((entry) => ({
    position: entry.position,
    required: entry.required,
  }))
}

export function itemizeScripts(text: string): readonly ScriptItem[] {
  assertWellFormed(text)

  const graphemes: GraphemeScript[] = []
  for (const segment of graphemeSegments(text)) {
    const end = segment.index + segment.segment.length
    graphemes.push({
      start: segment.index,
      end,
      script: resolveGraphemeScript(segment.segment),
    })
  }
  resolveNeutralScripts(graphemes)

  const scriptItems: ScriptItem[] = []
  for (const grapheme of graphemes) {
    const previous = scriptItems.at(-1)
    const script = uint32ToTag(grapheme.script)
    if (previous !== undefined && previous.end === grapheme.start && previous.script === script) {
      scriptItems[scriptItems.length - 1] = { ...previous, end: grapheme.end }
    } else {
      scriptItems.push({ start: grapheme.start, end: grapheme.end, script })
    }
  }

  return scriptItems
}

export function scriptForCodePoint(codePoint: number): string {
  assertScalar(codePoint)
  return uint32ToTag(lookupTriple(scriptRanges, codePoint))
}

export function scriptsForCodePoint(codePoint: number): readonly string[] {
  assertScalar(codePoint)
  const setIndex = lookupTriple(scriptExtensionRanges, codePoint)
  const start = scriptExtensionOffsets[setIndex]
  const end = scriptExtensionOffsets[setIndex + 1]
  if (start === undefined || end === undefined) throw new Error('invalid generated script set')
  const scripts = []
  for (let index = start; index < end; index += 1) {
    const tag = scriptExtensionTags[index]
    if (tag === undefined) throw new Error('invalid generated script tag')
    scripts.push(uint32ToTag(tag))
  }
  return scripts
}

function resolveGraphemeScript(text: string): number {
  let candidates: number[] | undefined
  let preferred = commonScript
  for (const scalar of text) {
    const codePoint = scalar.codePointAt(0)
    if (codePoint === undefined) continue
    const primary = lookupTriple(scriptRanges, codePoint)
    if (!isNeutralScript(primary) && preferred === commonScript) preferred = primary
    const extensions = extensionSet(codePoint).filter((script) => !isNeutralScript(script))
    if (extensions.length === 0) continue
    candidates = candidates === undefined
      ? extensions
      : candidates.filter((script) => extensions.includes(script))
  }
  if (candidates === undefined || candidates.length === 0) return preferred
  return candidates.includes(preferred) ? preferred : (candidates[0] ?? preferred)
}

function resolveNeutralScripts(graphemes: GraphemeScript[]): void {
  let previous = commonScript
  for (const grapheme of graphemes) {
    if (isNeutralScript(grapheme.script)) grapheme.script = previous
    else previous = grapheme.script
  }
  let next = commonScript
  for (let index = graphemes.length - 1; index >= 0; index -= 1) {
    const grapheme = graphemes[index]
    if (grapheme === undefined) continue
    if (isNeutralScript(grapheme.script)) grapheme.script = next
    else next = grapheme.script
  }
}

function extensionSet(codePoint: number): number[] {
  const setIndex = lookupTriple(scriptExtensionRanges, codePoint)
  const start = scriptExtensionOffsets[setIndex]
  const end = scriptExtensionOffsets[setIndex + 1]
  if (start === undefined || end === undefined) throw new Error('invalid generated script set')
  return Array.from(scriptExtensionTags.subarray(start, end))
}

function lookupTriple(ranges: Uint32Array, codePoint: number): number {
  let low = 0
  let high = ranges.length / 3 - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const offset = middle * 3
    const start = ranges[offset]
    const end = ranges[offset + 1]
    const value = ranges[offset + 2]
    if (start === undefined || end === undefined || value === undefined) break
    if (codePoint < start) high = middle - 1
    else if (codePoint >= end) low = middle + 1
    else return value
  }
  throw new RangeError(`Unicode scalar U+${codePoint.toString(16).toUpperCase()} is not classified`)
}

function isNeutralScript(script: number): boolean {
  return script === commonScript || script === inheritedScript || script === unknownScript
}

function uint32ToTag(value: number): string {
  return String.fromCharCode(value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
}

function assertScalar(codePoint: number): void {
  if (
    !Number.isInteger(codePoint) ||
    codePoint < 0 ||
    codePoint > 0x10_ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    throw new RangeError('code point must be a Unicode scalar value')
  }
}

function assertWellFormed(text: string): void {
  if (!text.isWellFormed()) throw new RangeError('paragraph text must be well-formed UTF-16')
}
