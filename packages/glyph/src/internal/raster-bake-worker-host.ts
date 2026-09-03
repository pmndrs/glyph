import type { RasterBakeArtifact } from '../bake.js';
import { GlyphError } from '../glyph-error.js';
import type { RasterKey } from '../identity.js';
import type { RuntimeRasterBakeRequest, RuntimeRasterBakerModule } from '../raster.js';
import { copyToOwnedArrayBuffer } from './owned-array-buffer.js';
import {
  isRasterBakeWorkerResult,
  type RasterBakeWorkerRequest,
  type RasterBakeWorkerResult,
} from './raster-bake-worker-protocol.js';
import { SerialWorkerHost } from './serial-worker-host.js';
import { isBakeProgressMessage, type BakeProgressMessage } from './bake-progress-protocol.js';

class RuntimeRasterBakeError extends GlyphError<'bake-failed'> {
  readonly reason: string;
  readonly path: string | undefined;

  constructor(error: { readonly code: string; readonly message: string; readonly path?: string }) {
    super('bake-failed', error.message);
    this.name = 'RuntimeRasterBakeError';
    this.reason = error.code;
    this.path = error.path;
  }
}

export function createRasterBakeWorkerHost<Kind extends string, Options>(options: {
  readonly kind: Kind;
  readonly name: string;
  readonly workerUrl: URL;
}): RuntimeRasterBakerModule<Kind, Options> {
  const host = new SerialWorkerHost<
    RuntimeRasterBakeRequest<Options>,
    RasterBakeWorkerRequest,
    RasterBakeWorkerResult,
    RasterBakeArtifact<Kind>,
    BakeProgressMessage
  >({
    name: options.name,
    workerUrl: options.workerUrl,
    prepare(request, id) {
      const source = copyToOwnedArrayBuffer(request.source);
      return {
        message: {
          type: 'bake-raster-v0',
          id,
          source,
          fontFaceIndex: request.fontFaceIndex,
          glyphCount: request.font.glyphCount,
          shapingHash: request.font.shapingHash,
          rasterKey: rasterKey(request.rasterKey),
          options: 'options' in request ? request.options : undefined,
        },
        transfer: [source],
      };
    },
    isResponse: isRasterBakeWorkerResult,
    responseId: (response) => response.id,
    resolve(response) {
      if (!response.ok) throw new RuntimeRasterBakeError(response.error);
      if (response.kind !== options.kind) {
        throw new TypeError(`${options.name} returned ${response.kind} instead of ${options.kind}`);
      }
      return {
        rasterKey: response.rasterKey,
        kind: options.kind,
        extension: response.extension,
        version: response.version,
        artifacts: response.artifacts.map((artifact) => ({
          ...artifact,
          bytes: new Uint8Array(artifact.bytes),
        })),
        report: response.report,
      };
    },
    progress: {
      isProgress: isBakeProgressMessage,
      progressId: (progress) => progress.id,
      report: (request, { stage, phase, completed, total }) => request.onProgress?.({ stage, phase, completed, total }),
    },
  });
  return {
    kind: options.kind,
    bake(request) {
      request.onProgress?.({ stage: 'raster', phase: 'queued', completed: 0, total: 1 });
      return host.run(request, request.signal);
    },
  };
}

function rasterKey(value: string): RasterKey {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new TypeError('runtime raster key must be SHA-256');
  return value as RasterKey;
}
