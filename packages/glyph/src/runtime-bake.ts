import { FontBakeError } from './font-baker/index.js';

import type { RuntimeFontBake, RuntimeFontBakeRequest } from './loader.js';
import { fontBakeDescriptorV0 } from './internal/core-bake-policy.js';
import { copyToOwnedArrayBuffer } from './internal/owned-array-buffer.js';
import { normalizeUnicodeRanges } from './internal/font-selection.js';
import {
  isRuntimeBakeResultV0,
  type RuntimeBakeRequestV0,
  type RuntimeBakeResultV0,
} from './internal/runtime-bake-protocol.js';

export { workerRasterKinds } from './internal/runtime-bake-protocol.js';
import { SerialWorkerHost } from './internal/serial-worker-host.js';
import { isBakeProgressMessageV0, type BakeProgressMessageV0 } from './internal/bake-progress-protocol.js';

const host = new SerialWorkerHost<
  RuntimeFontBakeRequest,
  RuntimeBakeRequestV0,
  RuntimeBakeResultV0,
  Uint8Array,
  BakeProgressMessageV0
>({
  name: 'pmndrs-glyph-font-baker',
  workerUrl: new URL('./runtime-bake-worker.js', import.meta.url),
  prepare(request, id) {
    const source = copyToOwnedArrayBuffer(request.source);
    return {
      message: {
        type: 'bake-font-v0',
        id,
        source,
        font: fontBakeDescriptorV0(0),
        ...(request.cache === undefined ? {} : { cache: request.cache }),
        ...(request.unicodeRanges === undefined
          ? {}
          : { unicodeRanges: normalizeUnicodeRanges(request.unicodeRanges) }),
        ...(request.rasters === undefined ? {} : { rasters: request.rasters }),
      },
      transfer: [source],
    };
  },
  isResponse: isRuntimeBakeResultV0,
  responseId: (response) => response.id,
  resolve(response) {
    if (!response.ok) throw new FontBakeError(response.error);
    return new Uint8Array(response.artifacts[0]!.bytes);
  },
  progress: {
    isProgress: isBakeProgressMessageV0,
    progressId: (progress) => progress.id,
    report: (request, { stage, phase, completed, total }) => request.onProgress?.({ stage, phase, completed, total }),
  },
});

export const bakeFontInWorker: RuntimeFontBake = (request) => {
  request.onProgress?.({ stage: 'font', phase: 'queued', completed: 0, total: 1 });
  return host.run(request, request.signal);
};
