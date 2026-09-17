export function selectNearestRank(
  values: Float32Array,
  scratch: Float32Array,
  length: number,
  fraction: number,
): number {
  if (length === 0) return 0;
  if (values !== scratch) {
    for (let index = 0; index < length; index += 1) scratch[index] = values[index] ?? 0;
  }
  const selectedIndex = Math.min(length - 1, Math.ceil(length * fraction) - 1);
  let left = 0;
  let right = length - 1;
  while (left < right) {
    const pivot = scratch[(left + right) >>> 1] ?? 0;
    let lower = left;
    let upper = right;
    while (lower <= upper) {
      while ((scratch[lower] ?? 0) < pivot) lower += 1;
      while ((scratch[upper] ?? 0) > pivot) upper -= 1;
      if (lower > upper) break;
      const value = scratch[lower] ?? 0;
      scratch[lower] = scratch[upper] ?? 0;
      scratch[upper] = value;
      lower += 1;
      upper -= 1;
    }
    if (selectedIndex <= upper) right = upper;
    else if (selectedIndex >= lower) left = lower;
    else break;
  }
  return scratch[selectedIndex] ?? 0;
}
