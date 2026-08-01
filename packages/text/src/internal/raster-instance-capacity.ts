const DIRTY_BUCKET_SIZE = 32;
const MAX_DIRTY_RANGES = 8;

export interface RasterComponentRange {
  readonly start: number;
  readonly count: number;
}

/** Allocate bounded headroom for a non-empty retained instance buffer. */
export function rasterInstanceCapacity(required: number): number {
  assertCount(required, 'required instance count');
  if (required === 0) return 0;
  const capacity = required + Math.min(Math.max(1, Math.ceil(required / 4)), 256);
  if (!Number.isSafeInteger(capacity)) throw new RangeError('retained instance capacity exceeds safe integer range');
  return capacity;
}

/** Convert dirty logical instances into bounded component upload ranges. */
export function coalesceRasterInstanceRanges(
  dirtyInstances: readonly number[],
  logicalCount: number,
  componentStride: number,
): readonly RasterComponentRange[] {
  assertCount(logicalCount, 'logical instance count');
  if (!Number.isSafeInteger(componentStride) || componentStride < 1) {
    throw new RangeError('instance component stride must be a positive safe integer');
  }
  if (logicalCount === 0 || dirtyInstances.length === 0) return [];

  const bucketCount = Math.ceil(logicalCount / DIRTY_BUCKET_SIZE);
  const dirtyBuckets = new Uint8Array(bucketCount);
  for (const instance of dirtyInstances) {
    if (!Number.isSafeInteger(instance) || instance < 0 || instance >= logicalCount) {
      throw new RangeError('dirty instance lies outside the logical instance range');
    }
    dirtyBuckets[Math.floor(instance / DIRTY_BUCKET_SIZE)] = 1;
  }

  const ranges: RasterComponentRange[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    if (dirtyBuckets[bucket] === 0) continue;
    const firstBucket = bucket;
    while (bucket + 1 < bucketCount && dirtyBuckets[bucket + 1] !== 0) bucket += 1;
    const firstInstance = firstBucket * DIRTY_BUCKET_SIZE;
    const lastInstance = Math.min((bucket + 1) * DIRTY_BUCKET_SIZE, logicalCount);
    ranges.push({
      start: firstInstance * componentStride,
      count: (lastInstance - firstInstance) * componentStride,
    });
  }

  if (ranges.length > MAX_DIRTY_RANGES) {
    return [{ start: 0, count: logicalCount * componentStride }];
  }
  return ranges;
}

/** Recover logical instances whose prior upload ranges have not yet reached the GPU. */
export function pendingRasterDirtyInstances(
  ranges: readonly RasterComponentRange[],
  logicalCount: number,
  componentStride: number,
): number[] {
  assertCount(logicalCount, 'logical instance count');
  if (!Number.isSafeInteger(componentStride) || componentStride < 1) {
    throw new RangeError('instance component stride must be a positive safe integer');
  }
  const dirty: number[] = [];
  for (const range of ranges) {
    const first = Math.floor(range.start / componentStride);
    const last = Math.min(logicalCount, Math.ceil((range.start + range.count) / componentStride));
    for (let instance = Math.max(0, first); instance < last; instance += 1) dirty.push(instance);
  }
  return dirty;
}

/** Plan retained instance uploads without mutating the committed backing allocation. */
export function rasterInstanceUpdateRanges(
  liveValues: ArrayLike<number>,
  stagedValues: ArrayLike<number>,
  pendingRanges: readonly RasterComponentRange[],
  previousLogicalCount: number,
  logicalCount: number,
  componentStride: number,
): readonly RasterComponentRange[] {
  assertCount(previousLogicalCount, 'previous logical instance count');
  assertCount(logicalCount, 'logical instance count');
  if (!Number.isSafeInteger(componentStride) || componentStride < 1) {
    throw new RangeError('instance component stride must be a positive safe integer');
  }
  const logicalComponents = logicalCount * componentStride;
  if (liveValues.length < logicalComponents || stagedValues.length !== logicalComponents) {
    throw new RangeError('retained instance values do not match the logical instance range');
  }
  const dirtyInstances = pendingRasterDirtyInstances(pendingRanges, logicalCount, componentStride);
  for (let instance = 0; instance < logicalCount; instance += 1) {
    const start = instance * componentStride;
    let changed = instance >= previousLogicalCount;
    for (let component = 0; component < componentStride && !changed; component += 1) {
      changed = stagedValues[start + component] !== liveValues[start + component];
    }
    if (changed) dirtyInstances.push(instance);
  }
  return coalesceRasterInstanceRanges(dirtyInstances, logicalCount, componentStride);
}

function assertCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer`);
}
