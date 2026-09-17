import { describe, expect, it } from 'vitest';

import { CRACKS } from './config';
import { crackSegments, editLine, stampProgress, writeCrack } from './helpers';

describe('marble type editing', () => {
  it('inserts and removes at the caret without reordering input', () => {
    const inserted = editLine({ text: 'MKE', caret: 1 }, 'A', 8);
    expect(inserted).toEqual({ text: 'MAKE', caret: 2 });
    expect(editLine(inserted, 'Delete', 8)).toEqual({ text: 'MAE', caret: 2 });
    expect(editLine(inserted, 'Backspace', 8)).toEqual({ text: 'MKE', caret: 1 });
  });

  it('honours movement and the fixed line capacity', () => {
    expect(editLine({ text: 'STONE', caret: 2 }, 'End', 5)).toEqual({ text: 'STONE', caret: 5 });
    expect(editLine({ text: 'STONE', caret: 5 }, '!', 5)).toEqual({ text: 'STONE', caret: 5 });
  });
});

describe('marble type impact', () => {
  it('clamps an exponential strike to its endpoints', () => {
    expect(stampProgress(-1, 0.5)).toBe(0);
    expect(stampProgress(0.25, 0.5)).toBeGreaterThan(0.95);
    expect(stampProgress(1, 0.5)).toBe(1);
  });

  it('generates deterministic bounded crack columns', () => {
    const first = crackSegments(1, -2, 7);
    expect(first).toEqual(crackSegments(1, -2, 7));
    expect(first).toHaveLength(CRACKS.branches * CRACKS.segmentsPerBranch);

    const positions = new Float32Array(first.length * 6);
    expect(writeCrack(positions, 0, 1, -2, 0.3, 7)).toBe(positions.length);
    expect(Array.from(positions).every(Number.isFinite)).toBe(true);
  });
});
