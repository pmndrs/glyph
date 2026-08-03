const SLACK_DIVISOR = 4;
const MAX_SLACK = 256;
const DIRTY_BUCKET_INSTANCES = 32;
const MAX_DIRTY_RANGES = 8;

export interface UpdateRange {
  readonly start: number;
  readonly count: number;
}

export function retainedCapacity(required: number): number {
  if (!Number.isSafeInteger(required) || required < 0) {
    throw new RangeError('glyph-example instance count must be a non-negative safe integer');
  }
  if (required === 0) return 0;
  return required + Math.min(Math.ceil(required / SLACK_DIVISOR), MAX_SLACK);
}

export function dirtyRanges(
  current: Float32Array,
  replacement: Float32Array,
  previousCount: number,
  nextCount: number,
  stride: number,
): readonly UpdateRange[] {
  const comparedCount = Math.max(previousCount, nextCount);
  if (comparedCount === 0) return [];
  const ranges: UpdateRange[] = [];
  let rangeStart = -1;
  const bucketCount = Math.ceil(comparedCount / DIRTY_BUCKET_INSTANCES);
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const instanceStart = bucket * DIRTY_BUCKET_INSTANCES;
    const instanceEnd = Math.min(comparedCount, instanceStart + DIRTY_BUCKET_INSTANCES);
    const changed = bucketChanged(current, replacement, instanceStart, instanceEnd, nextCount, stride);
    if (changed && rangeStart < 0) rangeStart = instanceStart;
    if (!changed && rangeStart >= 0) {
      ranges.push(componentRange(rangeStart, instanceStart, nextCount, stride));
      rangeStart = -1;
    }
  }
  if (rangeStart >= 0) ranges.push(componentRange(rangeStart, comparedCount, nextCount, stride));
  return ranges.length > MAX_DIRTY_RANGES ? [{ start: 0, count: nextCount * stride }] : ranges;
}

function bucketChanged(
  current: Float32Array,
  replacement: Float32Array,
  start: number,
  end: number,
  nextCount: number,
  stride: number,
): boolean {
  if (end > nextCount) return true;
  const componentStart = start * stride;
  const componentEnd = end * stride;
  for (let component = componentStart; component < componentEnd; component += 1) {
    if (!Object.is(current[component], replacement[component])) return true;
  }
  return false;
}

function componentRange(start: number, end: number, nextCount: number, stride: number): UpdateRange {
  const boundedEnd = Math.min(end, nextCount);
  return { start: start * stride, count: Math.max(0, boundedEnd - start) * stride };
}
