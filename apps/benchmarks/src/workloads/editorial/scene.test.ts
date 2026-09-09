import { describe, expect, it, vi } from 'vitest';

import type { ComparisonWorkloadEntry } from '../shared/scene-entry';
import { layoutEditorialEntries } from './scene';

function editorialEntry(
  width: number,
  height: number,
): {
  readonly entry: ComparisonWorkloadEntry;
  readonly measure: ReturnType<typeof vi.fn>;
  readonly position: { x: number; y: number; z: number };
} {
  const position = {
    x: 0,
    y: 0,
    z: 0,
    set(x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
    },
  };
  const measure = vi.fn<() => { width: number; height: number }>(() => ({ width, height }));
  const text = { measure, position } as unknown as ComparisonWorkloadEntry['text'];
  return {
    entry: { node: text, role: 'primary', sourceText: '', text },
    measure,
    position,
  };
}

describe('editorial layout', () => {
  it('measures each paragraph once while centering the complete block', () => {
    const lede = editorialEntry(320, 80);
    const body = editorialEntry(400, 240);

    layoutEditorialEntries([lede.entry, body.entry], 1_000, 800);

    expect(lede.measure).toHaveBeenCalledTimes(1);
    expect(body.measure).toHaveBeenCalledTimes(1);
    expect(lede.position).toMatchObject({ x: 300, y: -240, z: 0 });
    expect(body.position).toMatchObject({ x: 300, y: -320, z: 0 });
  });
});
