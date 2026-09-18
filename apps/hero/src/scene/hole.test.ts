import { describe, expect, it } from 'vitest';

import {
  collapseAt,
  COLLAPSE_SECONDS,
  HORIZON,
  OPEN_SECONDS,
  POP_AT,
  PAPER_UNTIL,
  holdCollapse,
  tickCollapse,
  dismissCollapse,
  uHoleCollapse,
  uHoleBlackout,
  uHoleBurst,
} from './hole';
import { departureAt, flight } from './departure';

describe('collapseAt', () => {
  it('is closed before it opens and fully open before the pull takes hold', () => {
    expect(collapseAt(-1).beat).toBe('closed');
    expect(collapseAt(-1).pull).toBe(0);
    const open = collapseAt(OPEN_SECONDS);
    expect(open.beat).toBe('open');
    expect(open.time).toBeCloseTo(OPEN_SECONDS, 5);
    expect(open.horizon).toBeCloseTo(HORIZON, 5);
    expect(open.presence).toBeCloseTo(1, 5);
    expect(open.pull).toBeLessThan(0.05);
  });

  it('pulls harder the longer it is open, and never lets go before the pop', () => {
    let last = 0;
    for (let t = OPEN_SECONDS; t < POP_AT - 0.1; t += 0.05) {
      const { pull } = collapseAt(t);
      expect(pull).toBeGreaterThanOrEqual(last);
      last = pull;
    }
    expect(last).toBeGreaterThan(0.9);
  });

  it('pops once, drops the pull and the drawing together, and blacks out afterwards', () => {
    const before = collapseAt(POP_AT - 0.01);
    expect(before.sincePop).toBeUndefined();
    expect(before.blackout).toBe(0);
    const after = collapseAt(POP_AT + 0.05);
    expect(after.beat).toBe('black');
    expect(after.sincePop).toBeCloseTo(0.05, 5);
    expect(after.pull).toBe(0);
    expect(after.presence).toBe(0);
    expect(collapseAt(COLLAPSE_SECONDS).blackout).toBeCloseTo(1, 5);
    expect(collapseAt(COLLAPSE_SECONDS + 10).blackout).toBeCloseTo(1, 5);
  });
});

describe('glyph flight', () => {
  it('starts without recoil or a jump, then accelerates into the centre', () => {
    const departure = 1;
    const before = flight(departure - 0.000001, departure, 1);
    const released = flight(departure, departure, 1);
    expect(before.radius).toBeCloseTo(released.radius, 4);
    expect(released.radius).toBe(1);
    expect(before.radius).toBe(1);
    const early = flight(1.3, departure, 1).radius - flight(1.4, departure, 1).radius;
    const late = flight(1.8, departure, 1).radius - flight(1.9, departure, 1).radius;
    expect(late).toBeGreaterThan(early * 2);
    expect(flight(2, departure, 1).size).toBe(0);
    expect(flight(2, departure, 1).radius).toBe(0);
  });

  it('finishes every feature glyph before the paper is swallowed', () => {
    for (let index = 0; index < 100; index += 1) {
      expect(flight(PAPER_UNTIL, departureAt(1, index), 0.8).size).toBe(0);
    }
  });

  it('dismisses a held beat so replay restores the whole sheet', () => {
    holdCollapse(COLLAPSE_SECONDS);
    tickCollapse(0);
    expect(uHoleCollapse.value).toBe(1);
    expect(uHoleBlackout.value).toBe(1);
    dismissCollapse();
    const state = tickCollapse(1);
    expect(state.beat).toBe('closed');
    expect(uHoleCollapse.value).toBe(0);
    expect(uHoleBurst.value).toBe(-1);
    expect(uHoleBlackout.value).toBe(0);
  });
});
