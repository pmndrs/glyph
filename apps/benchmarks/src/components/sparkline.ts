export function sparklineSampleX(
  sampleIndex: number,
  sampleCount: number,
  capacity: number,
  width: number,
): number {
  const emptySlots = capacity - sampleCount
  return ((emptySlots + sampleIndex) / Math.max(1, capacity - 1)) * width
}
