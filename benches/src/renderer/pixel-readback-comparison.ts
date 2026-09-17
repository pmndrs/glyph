export interface PixelReadbackComparison {
  readonly changedChannels: number;
  readonly matches: boolean;
  readonly maxChannelDelta: number;
}

/** Compares normalized render-target channels with an explicit quantization allowance. */
export function comparePixelReadbacks(
  expected: ArrayLike<number>,
  actual: ArrayLike<number>,
  channelTolerance: number,
): PixelReadbackComparison {
  if (actual.length !== expected.length) {
    throw new Error(`pixel readback length ${String(actual.length)} did not match ${String(expected.length)}`);
  }
  if (!Number.isFinite(channelTolerance) || channelTolerance < 0) {
    throw new Error('pixel readback channel tolerance must be finite and non-negative');
  }

  let changedChannels = 0;
  let maxChannelDelta = 0;
  for (let index = 0; index < expected.length; index += 1) {
    const delta = Math.abs(actual[index]! - expected[index]!);
    if (delta > 0) changedChannels += 1;
    if (delta > maxChannelDelta) maxChannelDelta = delta;
  }
  return {
    changedChannels,
    matches: maxChannelDelta <= channelTolerance,
    maxChannelDelta,
  };
}
