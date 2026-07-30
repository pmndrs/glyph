export function logarithmicRangePosition(value: number, minimum: number, maximum: number): number {
  assertLogarithmicRange(value, minimum, maximum);
  return Math.min(1, Math.max(0, Math.log(value / minimum) / Math.log(maximum / minimum)));
}

export function logarithmicRangeValue(position: number, minimum: number, maximum: number, step: number): number {
  assertLogarithmicRange(minimum, minimum, maximum);
  if (!Number.isFinite(position)) throw new RangeError('range position must be finite');
  if (!Number.isFinite(step) || step <= 0) throw new RangeError('range step must be positive');
  const normalized = Math.min(1, Math.max(0, position));
  const value = minimum * Math.pow(maximum / minimum, normalized);
  return Math.min(maximum, Math.max(minimum, minimum + Math.round((value - minimum) / step) * step));
}

function assertLogarithmicRange(value: number, minimum: number, maximum: number): void {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    value <= 0 ||
    minimum <= 0 ||
    maximum <= minimum
  ) {
    throw new RangeError('logarithmic range values must be finite, positive, and increasing');
  }
}
