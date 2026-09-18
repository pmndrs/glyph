import { describe, expect, it } from 'vitest';

import {
  CUT_FLASH_SECONDS,
  Director,
  IMPACT_SLOW_SCALE,
  LAUNCH_AT,
  REWIND_CUT,
  TYPE_RATE,
  type Aim,
  type Beat,
} from './director';

const HEADLINE = 'Letters that learn to fall';
// Dyadic, so accumulated beat time is exact and floor() never sees rounding noise.
const FRAME = 1 / 64;
const AIM: Aim = { x: 0.25, y: -0.5 };

/** The first frame boundary at or after `seconds`: when a threshold on beatTime first passes. */
function frameCeil(seconds: number): number {
  return Math.ceil(seconds / FRAME) * FRAME;
}

const LAUNCH_FRAME_TIME = frameCeil(LAUNCH_AT);
const FLASH_END = frameCeil(CUT_FLASH_SECONDS);
/** Beat time at which scripted typing reveals the last character of HEADLINE. */
const TYPED_AT = frameCeil(HEADLINE.length / TYPE_RATE);

function run(director: Director, seconds: number): void {
  const steps = Math.round(seconds / FRAME);
  for (let step = 0; step < steps; step += 1) director.tick(FRAME);
}

/** Carries a director in intro through break and rewind into 'type'. */
function toType(director: Director, aim?: Aim): Director {
  director.launch(aim);
  director.recordingComplete();
  director.rewindComplete();
  return director;
}

function live(): Director {
  const director = new Director(HEADLINE);
  director.toggleLiveTyping();
  return director;
}

function inBreak(aim?: Aim): Director {
  const director = new Director(HEADLINE);
  director.launch(aim);
  return director;
}

function inRewind(): Director {
  const director = inBreak(AIM);
  director.recordingComplete();
  return director;
}

function inType(): Director {
  const director = inRewind();
  director.rewindComplete();
  return director;
}

function inHold(): Director {
  const director = inType();
  director.next();
  return director;
}

function expectFlash(director: Director): void {
  expect(director.state.cut).toBe(1);
  director.tick(FRAME);
  expect(director.state.cut).toBeCloseTo(1 - FRAME / CUT_FLASH_SECONDS, 12);
  run(director, FLASH_END - 2 * FRAME);
  expect(director.state.cut).toBeGreaterThan(0);
  director.tick(FRAME);
  expect(director.state.cut).toBe(0);
}

describe('Director', () => {
  describe('intro', () => {
    it('starts in intro with a cut flash and nothing typed', () => {
      expect(new Director(HEADLINE).state).toEqual({
        beat: 'intro',
        beatTime: 0,
        sceneTime: 0,
        timeScale: 1,
        cut: 1,
        headline: HEADLINE,
        typedCount: 0,
        liveTyping: false,
        aim: undefined,
        revision: 0,
      });
    });

    it('launches on its own with the default aim once LAUNCH_AT of real time has elapsed', () => {
      const director = new Director(HEADLINE);
      run(director, LAUNCH_FRAME_TIME - FRAME);
      expect(director.state).toMatchObject({ beat: 'intro', typedCount: 0, revision: 0 });
      director.tick(FRAME);
      expect(director.state).toMatchObject({
        beat: 'break',
        beatTime: 0,
        aim: undefined,
        typedCount: 0,
        cut: 0,
        revision: 1,
      });
    });

    it('next() launches at once with the default aim', () => {
      const director = new Director(HEADLINE);
      director.tick(FRAME);
      director.next();
      expect(director.state).toMatchObject({ beat: 'break', beatTime: 0, aim: undefined, revision: 1 });
    });

    it('launch() launches at once with its aim', () => {
      const director = new Director(HEADLINE);
      director.tick(FRAME);
      director.launch(AIM);
      expect(director.state).toMatchObject({ beat: 'break', beatTime: 0, aim: AIM, revision: 1 });
    });

    it('launch() is ignored outside intro', () => {
      const broken = inBreak(AIM);
      broken.launch({ x: -1, y: 1 });
      expect(broken.state).toMatchObject({ beat: 'break', aim: AIM, revision: 1 });

      const rewinding = inRewind();
      rewinding.launch(undefined);
      expect(rewinding.state).toMatchObject({ beat: 'rewind', aim: AIM, revision: 2 });

      const typing = inType();
      typing.launch(undefined);
      expect(typing.state).toMatchObject({ beat: 'type', aim: AIM, revision: 3 });

      const holding = inHold();
      holding.launch(undefined);
      expect(holding.state).toMatchObject({ beat: 'hold', aim: AIM, revision: 4 });
    });
  });

  describe('break', () => {
    it('next() is ignored in break and rewind', () => {
      const broken = inBreak();
      broken.next();
      expect(broken.state).toMatchObject({ beat: 'break', revision: 1 });

      const rewinding = inRewind();
      rewinding.next();
      expect(rewinding.state).toMatchObject({ beat: 'rewind', revision: 2 });
    });

    it('runs at full speed until contact, with nothing typed', () => {
      const director = inBreak();
      run(director, 1);
      expect(director.state).toMatchObject({ beat: 'break', timeScale: 1, typedCount: 0, revision: 1 });
    });

    it('contact() ramps timeScale down, holds, and eases back in real time', () => {
      const director = inBreak();
      director.contact();
      expect(director.state.timeScale).toBe(1);

      // 2 frames into the ramp-in.
      run(director, 2 * FRAME);
      expect(director.state.timeScale).toBeGreaterThan(IMPACT_SLOW_SCALE);
      expect(director.state.timeScale).toBeLessThan(1);

      // 0.5 s after contact: held.
      run(director, 0.5 - 2 * FRAME);
      expect(director.state.timeScale).toBe(IMPACT_SLOW_SCALE);

      // 1.4375 s after contact: easing out.
      run(director, 0.9375);
      expect(director.state.timeScale).toBeGreaterThan(IMPACT_SLOW_SCALE);
      expect(director.state.timeScale).toBeLessThan(1);

      // 2 s after contact: full speed.
      run(director, 0.5625);
      expect(director.state.timeScale).toBe(1);
    });

    it('only the first contact() in a break starts the ramp and the flash', () => {
      const director = inBreak();
      director.contact();
      run(director, 0.5);
      director.contact();
      expect(director.state.cut).toBe(0);
      // A restarted ramp would still be easing out 1.5 s after the second contact.
      run(director, 1.5);
      expect(director.state.timeScale).toBe(1);
    });

    it('recordingComplete() enters rewind at full speed and keeps the aim', () => {
      const director = inBreak(AIM);
      director.contact();
      run(director, 0.5);
      expect(director.state.timeScale).toBe(IMPACT_SLOW_SCALE);
      director.recordingComplete();
      expect(director.state).toMatchObject({ beat: 'rewind', timeScale: 1, aim: AIM, beatTime: 0, typedCount: 0 });
    });
  });

  describe('rewind', () => {
    it('waits for rewindComplete() with nothing typed', () => {
      const director = inRewind();
      run(director, 2);
      expect(director.state).toMatchObject({ beat: 'rewind', typedCount: 0, revision: 2 });
    });

    it('rewindComplete() starts scripted typing from zero and keeps the aim', () => {
      const director = inRewind();
      run(director, 0.5);
      director.rewindComplete();
      expect(director.state).toMatchObject({
        beat: 'type',
        beatTime: 0,
        timeScale: 1,
        aim: AIM,
        headline: HEADLINE,
        typedCount: 0,
        revision: 3,
      });
    });
  });

  describe('scripted typing', () => {
    it('reveals TYPE_RATE characters per real second', () => {
      const director = inType();
      run(director, 0.5);
      expect(director.state.typedCount).toBe(12);
      expect(director.state).toMatchObject({ beat: 'type', typedCount: Math.floor(0.5 * TYPE_RATE) });
    });

    it('enters hold on the frame that reveals the last character', () => {
      const director = inType();
      run(director, TYPED_AT - FRAME);
      expect(director.state).toMatchObject({ beat: 'type', typedCount: HEADLINE.length - 1, revision: 3 });
      director.tick(FRAME);
      expect(director.state).toMatchObject({
        beat: 'hold',
        beatTime: 0,
        aim: AIM,
        typedCount: HEADLINE.length,
        revision: 4,
      });
    });

    it('next() reveals the whole headline and holds', () => {
      const director = inType();
      director.tick(FRAME);
      director.next();
      expect(director.state).toMatchObject({ beat: 'hold', beatTime: 0, typedCount: HEADLINE.length, revision: 4 });
    });
  });

  describe('hold', () => {
    it('waits for next() with the headline fully revealed', () => {
      const director = inHold();
      run(director, 2);
      expect(director.state).toMatchObject({ beat: 'hold', aim: AIM, typedCount: HEADLINE.length, revision: 4 });
    });

    it('next() returns to a clean intro', () => {
      const director = inHold();
      director.next();
      expect(director.state).toMatchObject({
        beat: 'intro',
        beatTime: 0,
        aim: undefined,
        timeScale: 1,
        typedCount: 0,
        headline: HEADLINE,
        revision: 5,
      });
    });
  });

  it('ignores physics reports that arrive outside their beat', () => {
    const intro = new Director(HEADLINE);
    run(intro, FLASH_END);
    intro.contact();
    intro.recordingComplete();
    intro.rewindComplete();
    expect(intro.state).toMatchObject({ beat: 'intro', cut: 0, revision: 0 });

    const broken = inBreak();
    broken.rewindComplete();
    expect(broken.state).toMatchObject({ beat: 'break', revision: 1 });

    const rewinding = inRewind();
    run(rewinding, FLASH_END);
    rewinding.contact();
    rewinding.recordingComplete();
    expect(rewinding.state).toMatchObject({ beat: 'rewind', cut: REWIND_CUT, timeScale: 1, revision: 2 });

    const typing = inType();
    typing.contact();
    typing.recordingComplete();
    typing.rewindComplete();
    expect(typing.state).toMatchObject({ beat: 'type', timeScale: 1, revision: 3 });

    const holding = inHold();
    holding.contact();
    holding.recordingComplete();
    holding.rewindComplete();
    expect(holding.state).toMatchObject({ beat: 'hold', timeScale: 1, revision: 4 });
  });

  describe('sceneTime', () => {
    it('advances by realDt × timeScale in break and by realDt elsewhere', () => {
      const director = new Director(HEADLINE);
      const expectAdvance = (expected: number): void => {
        const before = director.state.sceneTime;
        run(director, 0.25);
        expect(director.state.sceneTime - before).toBeCloseTo(expected, 12);
      };

      expectAdvance(0.25);
      director.next();
      expect(director.state.beat).toBe('break');
      expectAdvance(0.25);

      director.contact();
      run(director, 0.5);
      expect(director.state.timeScale).toBe(IMPACT_SLOW_SCALE);
      expectAdvance(0.25 * IMPACT_SLOW_SCALE);

      director.recordingComplete();
      expectAdvance(0.25);
      director.rewindComplete();
      expectAdvance(0.25);
      director.next();
      expect(director.state.beat).toBe('hold');
      expectAdvance(0.25);
    });

    it('never decreases, across the impact ramp and reset()', () => {
      const director = inBreak();
      director.contact();
      let previous = director.state.sceneTime;
      for (let step = 0; step < 128; step += 1) {
        director.tick(FRAME);
        expect(director.state.sceneTime).toBeGreaterThan(previous);
        previous = director.state.sceneTime;
      }
      director.reset();
      expect(director.state.sceneTime).toBe(previous);
    });
  });

  describe('reset', () => {
    it('returns to intro from break with the aim and timeScale cleared', () => {
      const director = inBreak(AIM);
      director.contact();
      run(director, 0.5);
      expect(director.state.timeScale).toBe(IMPACT_SLOW_SCALE);
      const { revision } = director.state;
      director.reset();
      expect(director.state).toMatchObject({
        beat: 'intro',
        beatTime: 0,
        aim: undefined,
        timeScale: 1,
        typedCount: 0,
        cut: 1,
        revision: revision + 1,
      });

      // The cleared aim stays cleared: the next automatic launch uses the default.
      run(director, LAUNCH_FRAME_TIME - FRAME);
      expect(director.state.beat).toBe('intro');
      director.tick(FRAME);
      expect(director.state).toMatchObject({ beat: 'break', aim: undefined, revision: revision + 2 });
    });

    it.each<[Beat, () => Director]>([
      ['break', () => inBreak(AIM)],
      ['rewind', inRewind],
      ['type', inType],
      ['hold', inHold],
    ])('returns to a clean intro from %s', (beat, build) => {
      const director = build();
      run(director, 2 * FRAME);
      const { revision } = director.state;
      expect(director.state.beat).toBe(beat);
      director.reset();
      expect(director.state).toMatchObject({
        beat: 'intro',
        beatTime: 0,
        aim: undefined,
        timeScale: 1,
        typedCount: 0,
        headline: HEADLINE,
        cut: 1,
        revision: revision + 1,
      });
    });

    it('bumps revision even when already in intro', () => {
      const director = new Director(HEADLINE);
      director.reset();
      expect(director.state).toMatchObject({ beat: 'intro', revision: 1 });
    });
  });

  describe('cut', () => {
    it('flashes on intro, first contact, rewind, and type, but not on break or hold', () => {
      const director = new Director(HEADLINE);
      expectFlash(director);

      director.next();
      expect(director.state).toMatchObject({ beat: 'break', cut: 0 });
      director.contact();
      expectFlash(director);

      director.recordingComplete();
      expect(director.state).toMatchObject({ beat: 'rewind', cut: 1 });
      director.rewindComplete();
      expect(director.state.beat).toBe('type');
      expectFlash(director);

      director.next();
      expect(director.state).toMatchObject({ beat: 'hold', cut: 0 });
      director.next();
      expect(director.state.beat).toBe('intro');
      expectFlash(director);

      director.next();
      expect(director.state).toMatchObject({ beat: 'break', cut: 0 });
      director.reset();
      expectFlash(director);
    });

    it('stays at or above REWIND_CUT throughout rewind, then flashes out on type', () => {
      const director = inRewind();
      expect(director.state.cut).toBe(1);
      for (let step = 0; step < 128; step += 1) {
        director.tick(FRAME);
        expect(director.state.cut).toBeGreaterThanOrEqual(REWIND_CUT);
      }
      expect(director.state.cut).toBe(REWIND_CUT);
      director.rewindComplete();
      expectFlash(director);
    });
  });

  describe('live typing', () => {
    it('entering type clears the headline and reveals every keystroke', () => {
      const director = live();
      expect(director.state.liveTyping).toBe(true);
      director.launch(AIM);
      director.recordingComplete();
      expect(director.state).toMatchObject({ beat: 'rewind', headline: HEADLINE, typedCount: 0 });
      director.rewindComplete();
      expect(director.state).toMatchObject({ beat: 'type', headline: '', typedCount: 0 });

      director.typeCharacter('H');
      director.typeCharacter('i!');
      expect(director.state).toMatchObject({ headline: 'Hi!', typedCount: 3 });
      director.backspace();
      expect(director.state).toMatchObject({ headline: 'Hi', typedCount: 2 });
      // Live typing never completes on its own.
      run(director, 2);
      expect(director.state).toMatchObject({ beat: 'type', typedCount: 2 });
    });

    it('next() holds only once the live headline is non-empty', () => {
      const director = toType(live(), AIM);
      director.next();
      expect(director.state).toMatchObject({ beat: 'type', headline: '' });
      director.typeCharacter('x');
      director.backspace();
      director.next();
      expect(director.state).toMatchObject({ beat: 'type', headline: '', revision: 3 });

      director.typeCharacter('x');
      director.next();
      expect(director.state).toMatchObject({ beat: 'hold', headline: 'x', typedCount: 1, aim: AIM, revision: 4 });
    });

    it('ignores keystrokes unless live typing in type', () => {
      const scripted = inType();
      scripted.typeCharacter('x');
      scripted.backspace();
      expect(scripted.state.headline).toBe(HEADLINE);

      const director = live();
      director.typeCharacter('x');
      expect(director.state).toMatchObject({ beat: 'intro', headline: HEADLINE });
      director.launch(AIM);
      director.typeCharacter('x');
      expect(director.state).toMatchObject({ beat: 'break', headline: HEADLINE });
      director.recordingComplete();
      director.backspace();
      expect(director.state).toMatchObject({ beat: 'rewind', headline: HEADLINE });
      director.rewindComplete();
      director.typeCharacter('ok');
      director.next();
      director.typeCharacter('!');
      director.backspace();
      expect(director.state).toMatchObject({ beat: 'hold', headline: 'ok' });
    });

    it('toggling during type restarts the beat without a new revision', () => {
      const director = inType();
      run(director, 0.5);
      const { revision } = director.state;

      director.toggleLiveTyping();
      expect(director.state).toMatchObject({
        beat: 'type',
        liveTyping: true,
        beatTime: 0,
        headline: '',
        typedCount: 0,
        revision,
      });
      run(director, 2);
      expect(director.state.beat).toBe('type');

      director.typeCharacter('ab');
      director.toggleLiveTyping();
      expect(director.state).toMatchObject({
        beat: 'type',
        liveTyping: false,
        beatTime: 0,
        headline: HEADLINE,
        typedCount: 0,
        revision,
      });
    });

    it('reset() keeps the live headline only while live typing', () => {
      const director = toType(live(), AIM);
      director.typeCharacter('Hi');
      director.next();
      director.reset();
      expect(director.state).toMatchObject({ beat: 'intro', liveTyping: true, headline: 'Hi', typedCount: 0 });

      // The kept headline is what falls in the next break.
      director.next();
      expect(director.state).toMatchObject({ beat: 'break', headline: 'Hi', typedCount: 0 });
      director.recordingComplete();
      director.rewindComplete();
      director.typeCharacter('Yo');
      director.next();
      director.toggleLiveTyping();
      director.reset();
      expect(director.state).toMatchObject({ beat: 'intro', liveTyping: false, headline: HEADLINE });
    });
  });

  it('walks intro → break → rewind → type → hold → intro with the aim and typedCount of each beat', () => {
    const director = new Director(HEADLINE);
    director.tick(FRAME);
    expect(director.state).toMatchObject({ beat: 'intro', aim: undefined, typedCount: 0 });

    director.launch(AIM);
    run(director, 1);
    expect(director.state).toMatchObject({ beat: 'break', aim: AIM, typedCount: 0 });

    director.recordingComplete();
    run(director, 1);
    expect(director.state).toMatchObject({ beat: 'rewind', aim: AIM, typedCount: 0 });

    director.rewindComplete();
    run(director, 0.5);
    expect(director.state).toMatchObject({ beat: 'type', aim: AIM, typedCount: 12 });

    run(director, TYPED_AT - 0.5);
    expect(director.state).toMatchObject({ beat: 'hold', aim: AIM, typedCount: HEADLINE.length });

    director.next();
    expect(director.state).toMatchObject({ beat: 'intro', aim: undefined, typedCount: 0 });
  });

  it('increments revision exactly once per beat change', () => {
    const director = new Director(HEADLINE);
    const seen: [Beat, number][] = [[director.state.beat, director.state.revision]];
    const record = (): void => {
      seen.push([director.state.beat, director.state.revision]);
    };

    run(director, LAUNCH_FRAME_TIME);
    record();
    director.recordingComplete();
    record();
    director.rewindComplete();
    record();
    run(director, TYPED_AT);
    record();
    director.next();
    record();

    expect(seen).toEqual([
      ['intro', 0],
      ['break', 1],
      ['rewind', 2],
      ['type', 3],
      ['hold', 4],
      ['intro', 5],
    ]);
  });

  it('rejects a negative or non-finite realDt', () => {
    const director = new Director(HEADLINE);
    for (const dt of [-FRAME, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => director.tick(dt)).toThrow(RangeError);
    }
    director.tick(0);
    expect(director.state).toMatchObject({ beatTime: 0, sceneTime: 0 });
  });

  it('exposes a frozen snapshot that stays identical until the next call', () => {
    const director = new Director(HEADLINE);
    const snapshot = director.state;
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(director.state).toBe(snapshot);
    director.tick(FRAME);
    expect(director.state).not.toBe(snapshot);
    expect(snapshot.beatTime).toBe(0);
  });
});
