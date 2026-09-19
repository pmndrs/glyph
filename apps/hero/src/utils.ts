/** Deterministic jitter in [0, 1) from an index. */
export function jitter(index: number): number {
  const value = Math.sin(index * 12.9898 + 78.233) * 43_758.545_3;

  return value - Math.floor(value);
}
