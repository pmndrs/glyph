import type {
  BakeProgressListener,
  RasterBakeArtifact,
  RasterBakeRequest,
  RasterBakerModule,
  SerializedBakeError,
} from '../bake.js';
import { slugBakerAbi, type SlugBakerAbi } from '../generated/slug-baker-abi.js';
import {
  createDirectRasterBakerFromInstance,
  instantiateWasm,
  type DirectRasterBakerAbi,
} from '../internal/raster-baker-wasm.js';
import {
  SLUG_EXTENSION,
  SLUG_FORMAT_VERSION,
  SLUG_KIND,
  slugDescriptor,
  type SlugOptions,
  type SlugDescriptor,
} from '../internal/slug-contract.js';
import { cacheSuccessfulPromise } from '../internal/successful-promise-cache.js';
import { GlyphError } from '../glyph-error.js';
import type { Fingerprint, RasterKey } from '../identity.js';

export { slugBakerAbi } from '../generated/slug-baker-abi.js';

export type SlugBakerOptions = SlugOptions | undefined;

export interface SlugBakerRequest {
  readonly sourceFingerprint: Fingerprint;
  readonly fontFaceIndex: number;
  readonly glyphCount: number;
  readonly shapingFingerprint: Fingerprint;
  readonly rasterKey: RasterKey;
  readonly packaging: {
    readonly artifact: 'embedded' | 'external';
  };
  readonly descriptor: SlugDescriptor;
}

export interface SlugBakerCoreRequest {
  readonly source: Uint8Array;
  readonly request: SlugBakerRequest;
  readonly onProgress?: BakeProgressListener;
}

export interface SlugBakerCore {
  bake(request: SlugBakerCoreRequest): RasterBakeArtifact<typeof SLUG_KIND>;
}

export type SlugBakerWasmSource = BufferSource | WebAssembly.Module;
export type { SlugBakerAbi };

export class SlugBakeError extends GlyphError<'bake-failed'> {
  readonly reason: string;
  readonly path: string | undefined;

  constructor(error: SerializedBakeError) {
    super('bake-failed', error.message);
    this.name = 'SlugBakeError';
    this.reason = error.code;
    this.path = error.path;
  }
}

export async function createSlugBaker(source: SlugBakerWasmSource): Promise<SlugBakerCore> {
  let listener: BakeProgressListener | undefined;
  const instance = await instantiateWasm(source, {
    env: {
      pmndrs_glyph_bake_progress(completed: number, total: number) {
        listener?.({ stage: 'raster', phase: 'rasterizing', completed, total });
      },
    },
  });
  const core = createSlugBakerFromInstance(instance);
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

export function createSlugBakerFromInstance(instance: WebAssembly.Instance): SlugBakerCore {
  return createDirectRasterBakerFromInstance<SlugBakerRequest, typeof SLUG_KIND>(
    instance,
    slugBakerAbi satisfies DirectRasterBakerAbi,
    {
      label: 'Slug baker',
      kind: SLUG_KIND,
      extension: SLUG_EXTENSION,
      version: SLUG_FORMAT_VERSION,
      pageFormat: 'rgba16float',
      createError: (error) => new SlugBakeError(error),
    },
  );
}

export function slugBakerFromCore(
  core: SlugBakerCore,
): RasterBakerModule<typeof SLUG_KIND, SlugBakerOptions, SlugDescriptor> {
  return {
    kind: SLUG_KIND,
    extension: SLUG_EXTENSION,
    version: SLUG_FORMAT_VERSION,
    descriptor: slugDescriptor,
    async bake(request: RasterBakeRequest<SlugDescriptor>) {
      request.signal?.throwIfAborted();
      const result = core.bake({
        source: request.font.source,
        ...(request.onProgress === undefined ? {} : { onProgress: request.onProgress }),
        request: {
          sourceFingerprint: request.font.sourceFingerprint,
          fontFaceIndex: request.font.fontFaceIndex,
          glyphCount: request.font.glyphCount,
          shapingFingerprint: request.font.shapingFingerprint,
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

async function loadDefaultSlugBaker(): Promise<ReturnType<typeof slugBakerFromCore>> {
  const wasmUrl = new URL('../../dist/slug-baker.wasm', import.meta.url);
  let bytes: BufferSource;
  if (wasmUrl.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises');
    bytes = await readFile(wasmUrl);
  } else {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`Unable to load Slug baker Wasm (${response.status})`);
    bytes = await response.arrayBuffer();
  }
  return slugBakerFromCore(await createSlugBaker(bytes));
}

const defaultSlugBaker = cacheSuccessfulPromise(loadDefaultSlugBaker);

export const slugBaker: RasterBakerModule<typeof SLUG_KIND, SlugBakerOptions, SlugDescriptor> = {
  kind: SLUG_KIND,
  extension: SLUG_EXTENSION,
  version: SLUG_FORMAT_VERSION,
  descriptor: slugDescriptor,
  async bake(request) {
    return (await defaultSlugBaker()).bake(request);
  },
};

export default slugBaker;
