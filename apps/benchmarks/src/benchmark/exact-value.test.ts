import { describe, expect, it } from 'vitest';
import { exactValue } from './exact-value';

describe('exactValue', () => {
  it('compares finite JSON-shaped values without coercion', () => {
    expect(exactValue({ a: [1, 'x', false, null] }, { a: [1, 'x', false, null] })).toBe(true);
    expect(exactValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(exactValue({ a: 0 }, { a: -0 })).toBe(false);
  });

  it('rejects non-finite values and exotic records', () => {
    expect(exactValue({ value: Number.NaN }, { value: null })).toBe(false);
    expect(exactValue({ value: Number.POSITIVE_INFINITY }, { value: null })).toBe(false);
    expect(exactValue(new Date(0), new Date(0))).toBe(false);
  });
});
