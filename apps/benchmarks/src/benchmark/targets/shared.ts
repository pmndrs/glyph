import type { BenchmarkControls, BenchmarkExecutionContext, BenchmarkInput, BenchmarkTarget } from '../contracts';

export type BenchmarkTargetMetadata = Pick<
  BenchmarkTarget,
  'id' | 'label' | 'detail' | 'color' | 'capabilities' | 'status'
>;

export interface DeferredTargetOptions {
  readonly forwardsConfiguration?: boolean;
}

export function createDeferredTarget(
  metadata: BenchmarkTargetMetadata,
  create: () => Promise<BenchmarkTarget>,
  options: DeferredTargetOptions = {},
): BenchmarkTarget {
  let loaded: BenchmarkTarget | undefined;
  let configuredInput: BenchmarkInput = {};

  const load = async (controls: BenchmarkControls, context?: BenchmarkExecutionContext): Promise<void> => {
    loaded ??= await create();
    if (options.forwardsConfiguration) loaded.configure?.(configuredInput);
    await loaded.load(controls, context);
  };
  const run: BenchmarkTarget['run'] = async (input, sampleIndex, controls, context) => {
    if (loaded === undefined) throw new Error(`${metadata.label} target was not loaded`);
    return loaded.run(input, sampleIndex, controls, context);
  };
  const dispose = async (): Promise<void> => {
    const target = loaded;
    loaded = undefined;
    if (target !== undefined) await target.dispose();
  };

  return {
    ...metadata,
    ...(options.forwardsConfiguration
      ? {
          configure: (input: BenchmarkInput) => {
            configuredInput = input;
            loaded?.configure?.(input);
          },
        }
      : {}),
    load,
    run,
    dispose,
  };
}

export async function sha256(bytes: ArrayBufferView): Promise<string> {
  const owned = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice().buffer;
  const digest = await crypto.subtle.digest('SHA-256', owned);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
