import { FontBakeError } from '@pmndrs/text-font-baker'

import type { RuntimeFontBake, RuntimeFontBakeRequest } from './loader.js'
import { fontBakeDescriptorV0 } from './internal/core-bake-policy.js'
import { copyToOwnedArrayBuffer } from './internal/owned-array-buffer.js'
import {
  isRuntimeBakeResultV0,
  type RuntimeBakeRequestV0,
  type RuntimeBakeResultV0,
} from './internal/runtime-bake-protocol.js'
import { SerialWorkerHost } from './internal/serial-worker-host.js'

const host = new SerialWorkerHost<
  RuntimeFontBakeRequest,
  RuntimeBakeRequestV0,
  RuntimeBakeResultV0,
  Uint8Array
>({
  name: 'pmndrs-text-font-baker',
  workerUrl: new URL('./runtime-bake-worker.js', import.meta.url),
  prepare(request, id) {
    const source = copyToOwnedArrayBuffer(request.source)
    return {
      message: {
        type: 'bake-font-v0',
        id,
        source,
        font: fontBakeDescriptorV0(0),
      },
      transfer: [source],
    }
  },
  isResponse: isRuntimeBakeResultV0,
  responseId: (response) => response.id,
  resolve(response) {
    if (!response.ok) throw new FontBakeError(response.error)
    return new Uint8Array(response.artifacts[0]!.bytes)
  },
})

export const bakeFontInWorker: RuntimeFontBake = (request) => host.run(request, request.signal)
