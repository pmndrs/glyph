import { describe, expect, it } from 'vitest';
import type { BenchmarkMeasurement } from '../benchmark/contracts';
import { scenarioById } from '../benchmark/scenarios';

import {
  ADVANCED_SHAPING_CASES,
  ADVANCED_SHAPING_PRESENTATION_CYCLE_DURATION_MS,
  ADVANCED_SHAPING_PRESENTATION_CASE_IDS,
  advanceAdvancedShaping,
  advanceAdvancedShapingByTime,
  advancedShapingLiveTextScene,
  advancedShapingFrame,
  advancedShapingFrames,
  initialAdvancedShapingState,
  updateAdvancedShaping,
} from './advanced-shaping/scene';

describe('Advanced Shaping workload timeline', () => {
  it('starts the live showcase on CJK without publishing an empty playing frame', () => {
    expect(initialAdvancedShapingState()).toMatchObject({
      playing: true,
      auto: true,
      caseId: 'cjk-line-breaks',
      revealUnitsPerSecond: 180,
      tick: 1,
    });
  });

  it('projects each authored frame into the exact live Text scene', () => {
    const frame = advancedShapingFrame(initialAdvancedShapingState());
    expect(advancedShapingLiveTextScene(frame)).toEqual({
      anchor: 'measure-center',
      animatePresentation: false,
      direction: 'ltr',
      expectedGlyphCount: undefined,
      features: [],
      fontFixture: 'noto-sans-cjk-showcase',
      language: 'ja',
      layoutWidthRatio: 0.7,
      presentation: 'timeline',
      text: '文',
      textAlign: 'start',
      timelineTick: 1,
    });
  });

  it('preserves an explicitly selected compatible font fixture', () => {
    const frame = advancedShapingFrame(initialAdvancedShapingState());

    expect(advancedShapingLiveTextScene(frame, 'dot-gothic-16').fontFixture).toBe('dot-gothic-16');
  });

  it('completes one presentation cycle at the authored duration', () => {
    const completed = advanceAdvancedShapingByTime(
      initialAdvancedShapingState(),
      ADVANCED_SHAPING_PRESENTATION_CYCLE_DURATION_MS,
    );
    expect(completed).toMatchObject({ caseId: 'cjk-line-breaks', tick: 1 });
  });

  it('seeks exact authored reveal units and pauses while scrubbing', () => {
    const initial = updateAdvancedShaping(initialAdvancedShapingState(), {
      kind: 'select-case',
      caseId: 'latin-features',
    });
    const playing = updateAdvancedShaping(initial, { kind: 'play' });
    const scrubbed = updateAdvancedShaping(playing, { kind: 'seek', tick: 15 });
    expect(advancedShapingFrame(scrubbed).text).toBe('AVATAR office e\u0301');
    expect(scrubbed.playing).toBe(false);
  });

  it('advances from a completed case to the next authored case while auto is enabled', () => {
    let state = updateAdvancedShaping(initialAdvancedShapingState(), { kind: 'play' });
    expect(state.tick).toBe(1);
    const tickCount = advancedShapingFrame(state).tickCount;
    for (let index = 1; index < tickCount; index += 1) state = advanceAdvancedShaping(state);
    expect(state).toMatchObject({ tick: tickCount, playing: true });
    expect(advanceAdvancedShaping(state)).toMatchObject({
      caseId: 'mixed-bidi',
      tick: 1,
      playing: true,
    });
  });

  it('cycles every shaping case in linear order and wraps to the first case', () => {
    let state = initialAdvancedShapingState();
    for (const [index, caseId] of ADVANCED_SHAPING_PRESENTATION_CASE_IDS.entries()) {
      expect(state.caseId).toBe(caseId);
      const definition = ADVANCED_SHAPING_CASES.find((candidate) => candidate.id === caseId)!;
      state = { ...state, tick: definition.showcaseRevealUnits.length };
      state = advanceAdvancedShaping(state);
      expect(state.caseId).toBe(
        ADVANCED_SHAPING_PRESENTATION_CASE_IDS[(index + 1) % ADVANCED_SHAPING_PRESENTATION_CASE_IDS.length],
      );
    }
    expect(state.caseId).toBe('cjk-line-breaks');
  });

  it('loops the selected case instead when auto is disabled', () => {
    let state = updateAdvancedShaping(initialAdvancedShapingState(), { kind: 'set-auto', enabled: false });
    state = { ...state, tick: advancedShapingFrame(state).tickCount };
    expect(advanceAdvancedShaping(state)).toMatchObject({
      auto: false,
      caseId: 'cjk-line-breaks',
      tick: 1,
    });
  });

  it('uses elapsed frame time and adjustable speed without owning a timer', () => {
    const initial = updateAdvancedShaping(initialAdvancedShapingState(), {
      kind: 'set-speed',
      revealUnitsPerSecond: 20,
    });
    const partial = advanceAdvancedShapingByTime(initial, 49);
    expect(partial).toMatchObject({ tick: 1, revealCarryMs: 49 });
    const advanced = advanceAdvancedShapingByTime(partial, 101);
    expect(advanced).toMatchObject({ tick: 4, revealCarryMs: 0 });

    expect(advanceAdvancedShapingByTime(updateAdvancedShaping(advanced, { kind: 'pause' }), 500)).toMatchObject({
      tick: 4,
      revealCarryMs: 0,
    });
  });

  it('rejects invalid elapsed time and reveal speeds at the state boundary', () => {
    expect(() =>
      updateAdvancedShaping(initialAdvancedShapingState(), {
        kind: 'set-speed',
        revealUnitsPerSecond: 0,
      }),
    ).toThrow('advanced-shaping reveal speed must be a positive finite number');
    expect(() => advanceAdvancedShapingByTime(initialAdvancedShapingState(), -1)).toThrow(
      'advanced-shaping elapsed time must be a non-negative finite number',
    );
  });

  it('keeps edits whole and restores the authored deterministic timeline', () => {
    const edited = updateAdvancedShaping(initialAdvancedShapingState(), {
      kind: 'edit',
      text: 'A custom e\u0301 paragraph',
    });
    expect(advancedShapingFrame(edited)).toMatchObject({
      text: 'A custom e\u0301 paragraph',
      isEdited: true,
    });
    const reset = updateAdvancedShaping(edited, { kind: 'reset' });
    expect(advancedShapingFrame(reset)).toMatchObject({ text: '', tick: 0, isEdited: false });
  });

  it('defines every required universality lane with bounded integer widths', () => {
    expect(ADVANCED_SHAPING_CASES.map(({ id }) => id)).toEqual([
      'latin-features',
      'arabic-joining',
      'indic-reordering',
      'mixed-bidi',
      'cjk-line-breaks',
    ]);
    for (const definition of ADVANCED_SHAPING_CASES) {
      expect(definition.revealUnits.every((unit) => unit.length > 0)).toBe(true);
      expect(definition.showcaseRevealUnits.length).toBeGreaterThan(100);
      expect(definition.showcaseRevealUnits.every((unit) => unit.length > 0)).toBe(true);
      expect(Number.isSafeInteger(definition.showcaseWidthPermille)).toBe(true);
      expect(definition.showcaseWidthPermille).toBeGreaterThanOrEqual(300);
      expect(definition.showcaseWidthPermille).toBeLessThanOrEqual(900);
      expect(definition.widthPermille.every((width) => Number.isSafeInteger(width))).toBe(true);
      expect(definition.widthPermille.every((width) => width >= 300 && width <= 900)).toBe(true);
    }
  });

  it('keeps the live typewriter measure stable from its first to final grapheme', () => {
    for (const definition of ADVANCED_SHAPING_CASES) {
      const widths = [
        0,
        Math.floor(definition.showcaseRevealUnits.length / 2),
        definition.showcaseRevealUnits.length,
      ].map(
        (tick) =>
          advancedShapingFrame({
            ...initialAdvancedShapingState(),
            caseId: definition.id,
            playing: false,
            tick,
          }).widthPermille,
      );
      expect(new Set(widths)).toEqual(new Set([definition.showcaseWidthPermille]));
    }
  });

  it('rejects fractional timeline positions', () => {
    expect(() => updateAdvancedShaping(initialAdvancedShapingState(), { kind: 'seek', tick: 1.5 })).toThrow(
      'advanced-shaping tick must be an integer',
    );
  });

  it('derives every finite conformance frame from the same authored corpus', () => {
    const frames = advancedShapingFrames();
    expect(frames).toHaveLength(
      ADVANCED_SHAPING_CASES.reduce((count, definition) => count + definition.revealUnits.length + 1, 0),
    );
    for (const definition of ADVANCED_SHAPING_CASES) {
      const caseFrames = frames.filter((frame) => frame.caseDefinition.id === definition.id);
      expect(caseFrames.map(({ tick }) => tick)).toEqual(
        Array.from({ length: definition.revealUnits.length + 1 }, (_, tick) => tick),
      );
      expect(caseFrames.at(-1)?.text).toBe(definition.revealUnits.join(''));
    }
  });

  it('rejects a changed advanced-shaping conformance identity', () => {
    const scenario = scenarioById('advanced-shaping-conformance');
    const measurement: BenchmarkMeasurement = {
      sample: 0,
      durationMs: 0,
      outputBytes: 17_362,
      hash: '51ba1d14',
      metrics: {
        caseCount: 5,
        frameCount: 68,
        finalFrameCount: 5,
        layoutBytes: 17_362,
        glyphCount: 709,
        missingGlyphCount: 0,
        renderedGlyphCount: 625,
        drawCount: 72,
        coldReadyObservationCount: 5,
        warmLifecyclePublicationCount: 63,
        warmReadyWaitCount: 0,
      },
    };
    expect(scenario.validate([measurement])).toContain('68 frames/sample');
    expect(() => scenario.validate([{ ...measurement, hash: '414418c3' }])).toThrow('complete authored frame matrix');
    expect(() =>
      scenario.validate([
        {
          ...measurement,
          metrics: { ...measurement.metrics, missingGlyphCount: 1 },
        },
      ]),
    ).toThrow('complete authored frame matrix');
  });
});
