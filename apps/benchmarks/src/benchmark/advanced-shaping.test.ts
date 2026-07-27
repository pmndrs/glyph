import { describe, expect, it } from 'vitest'
import type { BenchmarkMeasurement } from './contracts'
import { scenarioById } from './scenarios'

import {
  ADVANCED_SHAPING_CASES,
  advanceAdvancedShaping,
  advancedShapingFrame,
  advancedShapingFrames,
  initialAdvancedShapingState,
  updateAdvancedShaping,
} from './advanced-shaping'

describe('advanced-shaping timeline', () => {
  it('starts the live showcase as a playing loop from its empty authored boundary', () => {
    expect(initialAdvancedShapingState()).toMatchObject({ playing: true, tick: 0 })
  })

  it('seeks exact authored reveal units and pauses while scrubbing', () => {
    const initial = initialAdvancedShapingState()
    const playing = updateAdvancedShaping(initial, { kind: 'play' })
    const scrubbed = updateAdvancedShaping(playing, { kind: 'seek', tick: 15 })
    expect(advancedShapingFrame(scrubbed).text).toBe('AVATAR office e\u0301')
    expect(scrubbed.playing).toBe(false)
  })

  it('advances only explicit playing state and loops at the authored boundary', () => {
    let state = updateAdvancedShaping(initialAdvancedShapingState(), { kind: 'play' })
    expect(state.tick).toBe(0)
    const tickCount = advancedShapingFrame(state).tickCount
    for (let index = 0; index < tickCount; index += 1) state = advanceAdvancedShaping(state)
    expect(state).toMatchObject({ tick: tickCount, playing: true })
    expect(advanceAdvancedShaping(state)).toMatchObject({ tick: 0, playing: true })
  })

  it('keeps edits whole and restores the authored deterministic timeline', () => {
    const edited = updateAdvancedShaping(initialAdvancedShapingState(), {
      kind: 'edit',
      text: 'A custom e\u0301 paragraph',
    })
    expect(advancedShapingFrame(edited)).toMatchObject({
      text: 'A custom e\u0301 paragraph',
      isEdited: true,
    })
    const reset = updateAdvancedShaping(edited, { kind: 'reset' })
    expect(advancedShapingFrame(reset)).toMatchObject({ text: '', tick: 0, isEdited: false })
  })

  it('defines every required universality lane with bounded integer widths', () => {
    expect(ADVANCED_SHAPING_CASES.map(({ id }) => id)).toEqual([
      'latin-features',
      'arabic-joining',
      'indic-reordering',
      'mixed-bidi',
      'cjk-line-breaks',
    ])
    for (const definition of ADVANCED_SHAPING_CASES) {
      expect(definition.revealUnits.every((unit) => unit.length > 0)).toBe(true)
      expect(definition.showcaseRevealUnits.length).toBeGreaterThan(100)
      expect(definition.showcaseRevealUnits.every((unit) => unit.length > 0)).toBe(true)
      expect(Number.isSafeInteger(definition.showcaseWidthPermille)).toBe(true)
      expect(definition.showcaseWidthPermille).toBeGreaterThanOrEqual(300)
      expect(definition.showcaseWidthPermille).toBeLessThanOrEqual(900)
      expect(definition.widthPermille.every((width) => Number.isSafeInteger(width))).toBe(true)
      expect(definition.widthPermille.every((width) => width >= 300 && width <= 900)).toBe(true)
    }
  })

  it('keeps the live typewriter measure stable from its first to final grapheme', () => {
    for (const definition of ADVANCED_SHAPING_CASES) {
      const widths = [
        0,
        Math.floor(definition.showcaseRevealUnits.length / 2),
        definition.showcaseRevealUnits.length,
      ].map(
        (tick) =>
          advancedShapingFrame({
            caseId: definition.id,
            playing: false,
            tick,
            editedText: undefined,
          }).widthPermille,
      )
      expect(new Set(widths)).toEqual(new Set([definition.showcaseWidthPermille]))
    }
  })

  it('rejects fractional timeline positions', () => {
    expect(() =>
      updateAdvancedShaping(initialAdvancedShapingState(), { kind: 'seek', tick: 1.5 }),
    ).toThrow('advanced-shaping tick must be an integer')
  })

  it('derives every finite conformance frame from the same authored corpus', () => {
    const frames = advancedShapingFrames()
    expect(frames).toHaveLength(
      ADVANCED_SHAPING_CASES.reduce(
        (count, definition) => count + definition.revealUnits.length + 1,
        0,
      ),
    )
    for (const definition of ADVANCED_SHAPING_CASES) {
      const caseFrames = frames.filter((frame) => frame.caseDefinition.id === definition.id)
      expect(caseFrames.map(({ tick }) => tick)).toEqual(
        Array.from({ length: definition.revealUnits.length + 1 }, (_, tick) => tick),
      )
      expect(caseFrames.at(-1)?.text).toBe(definition.revealUnits.join(''))
    }
  })

  it('rejects a changed advanced-shaping conformance identity', () => {
    const scenario = scenarioById('advanced-shaping-conformance')
    const measurement: BenchmarkMeasurement = {
      sample: 0,
      durationMs: 0,
      outputBytes: 17_362,
      hash: '314418c3',
      metrics: {
        caseCount: 5,
        frameCount: 68,
        finalFrameCount: 5,
        layoutBytes: 17_362,
        glyphCount: 709,
        missingGlyphCount: 0,
        renderedGlyphCount: 625,
        drawCount: 72,
      },
    }
    expect(scenario.validate([measurement])).toContain('68 frames/sample')
    expect(() => scenario.validate([{ ...measurement, hash: '414418c3' }])).toThrow(
      'complete authored frame matrix',
    )
    expect(() =>
      scenario.validate([
        {
          ...measurement,
          metrics: { ...measurement.metrics, missingGlyphCount: 1 },
        },
      ]),
    ).toThrow('complete authored frame matrix')
  })
})
