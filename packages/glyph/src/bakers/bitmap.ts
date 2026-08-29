import type {
  BakeProgressListener,
  RasterBakeArtifact,
  RasterBakeRequest,
  RasterBakerModule,
  SerializedBakeError,
} from '../bake.js';
import { createDirectRasterBakerFromInstance, instantiateWasm } from '../internal/raster-baker-wasm.js';
import { bitmapBakerAbi, type BitmapBakerAbi } from '../generated/bitmap-baker-abi.js';
import { cacheSuccessfulPromise } from '../internal/successful-promise-cache.js';
import {
  BITMAP_EXTENSION,
  BITMAP_FORMAT_VERSION,
  BITMAP_KIND,
  bitmapDescriptor,
  type BitmapDescriptor,
} from '../internal/bitmap-contract.js';
import type { RasterCoverage } from '../raster-coverage.js';

export { bitmapBakerAbi } from '../generated/bitmap-baker-abi.js';

export interface BitmapBakerOptions {
  readonly strikes: readonly [number, ...number[]];
  readonly coverage?: RasterCoverage;
}

export interface BitmapBakerRequest {
  readonly fontFaceIndex: number;
  readonly glyphCount: number;
  readonly shapingHash: string;
  readonly rasterKey: string;
  readonly packaging: {
    readonly artifact: 'embedded' | 'external';
    readonly pages: 'embedded' | 'external';
  };
  readonly descriptor: BitmapDescriptor;
}

export interface BitmapBakerCoreRequest {
  readonly source: Uint8Array;
  readonly request: BitmapBakerRequest;
  readonly onProgress?: BakeProgressListener;
}

export interface BitmapBakerCore {
  bake(request: BitmapBakerCoreRequest): RasterBakeArtifact<'bitmap'>;
}

export type BitmapBakerWasmSource = BufferSource | WebAssembly.Module;

export type { BitmapBakerAbi };

export class BitmapBakeError extends Error {
  readonly code: string;
  readonly path: string | undefined;

  constructor(error: SerializedBakeError) {
    super(error.message);
    this.name = 'BitmapBakeError';
    this.code = error.code;
    this.path = error.path;
  }
}

export async function createBitmapBaker(source: BitmapBakerWasmSource): Promise<BitmapBakerCore> {
  let listener: BakeProgressListener | undefined;
  const instance = await instantiateWasm(source, {
    env: {
      pmndrs_glyph_bake_progress(completed: number, total: number) {
        listener?.({ stage: 'raster', phase: 'rasterizing', completed, total });
      },
    },
  });
  const core = createBitmapBakerFromInstance(instance);
  return {
    bake(request) {
      listener = request.onProgress;
      try {
        return core.bake(request);
      } finally {
        listener = undefined;
      }
    },
  };
}

export function createBitmapBakerFromInstance(instance: WebAssembly.Instance): BitmapBakerCore {
  return createDirectRasterBakerFromInstance<BitmapBakerRequest, 'bitmap'>(instance, bitmapBakerAbi, {
    label: 'bitmap baker',
    kind: BITMAP_KIND,
    extension: BITMAP_EXTENSION,
    version: BITMAP_FORMAT_VERSION,
    pageFormat: 'r8unorm',
    createError: (error) => new BitmapBakeError(error),
  });
}

export function bitmapBakerFromCore(
  core: BitmapBakerCore,
): RasterBakerModule<'bitmap', BitmapBakerOptions, BitmapDescriptor> {
  return {
    kind: BITMAP_KIND,
    extension: BITMAP_EXTENSION,
    version: BITMAP_FORMAT_VERSION,
    descriptor: bitmapDescriptor,
    async bake(request: RasterBakeRequest<BitmapDescriptor>) {
      request.signal?.throwIfAborted();
      const result = core.bake({
        source: request.font.source,
        ...(request.onProgress === undefined ? {} : { onProgress: request.onProgress }),
        request: {
          fontFaceIndex: request.font.fontFaceIndex,
          glyphCount: request.font.glyphCount,
          shapingHash: request.font.shapingHash,
          rasterKey: request.rasterKey,
          packaging: request.packaging,
          descriptor: request.descriptor,
        },
      });
      request.signal?.throwIfAborted();
      return result;
    },
  };
}

async function loadDefaultBitmapBaker(): Promise<ReturnType<typeof bitmapBakerFromCore>> {
  const wasmUrl = new URL('../../dist/bitmap-baker.wasm', import.meta.url);
  let bytes: BufferSource;
  if (wasmUrl.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    bytes = await readFile(wasmUrl);
  } else {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`Unable to load bitmap baker Wasm (${response.status})`);
    bytes = await response.arrayBuffer();
  }
  return bitmapBakerFromCore(await createBitmapBaker(bytes));
}

const defaultBitmapBaker = cacheSuccessfulPromise(loadDefaultBitmapBaker);

export const bitmapBaker: RasterBakerModule<'bitmap', BitmapBakerOptions, BitmapDescriptor> = {
  kind: BITMAP_KIND,
  extension: BITMAP_EXTENSION,
  version: BITMAP_FORMAT_VERSION,
  descriptor: bitmapDescriptor,
  async bake(request) {
    return (await defaultBitmapBaker()).bake(request);
  },
};

export default bitmapBaker;
