import type { RasterBakeArtifact } from '../bake.js';
import {
  copyIntoWasm,
  decodeResponse,
  decodeSegmentedResponse,
  memoryRange,
  readExports,
  u32,
  type DirectRasterBakerAbi,
  type DirectRasterBakerSpec,
} from './raster-baker-wasm.js';

export interface DirectRasterBakerProfileSample {
  readonly requestEncodingMs: number;
  readonly wasmInputCopyMs: number;
  readonly wasmBakeMs: number;
  readonly wasmToHostCopyMs: number;
  readonly cleanupMs: number;
  readonly wasmMemoryBeforeBytes: number;
  readonly wasmMemoryPeakBytes: number;
  readonly wasmMemoryAfterBytes: number;
  readonly outputBytes: number;
}

const textEncoder = new TextEncoder();

export function createProfiledDirectRasterBakerFromInstance<Request, Kind extends string>(
  instance: WebAssembly.Instance,
  abi: DirectRasterBakerAbi,
  spec: DirectRasterBakerSpec<Kind>,
  observeProfile: (sample: DirectRasterBakerProfileSample) => void,
): {
  bake(input: { readonly source: Uint8Array; readonly request: Request }): RasterBakeArtifact<Kind>;
} {
  const exports = readExports(instance.exports, abi, spec.label);
  return {
    bake({ source, request }) {
      let phase = performance.now();
      const requestBytes = textEncoder.encode(JSON.stringify(request));
      const requestEncodingMs = performance.now() - phase;
      const wasmMemoryBeforeBytes = exports.memory.buffer.byteLength;
      let wasmMemoryPeakBytes = wasmMemoryBeforeBytes;
      let wasmInputCopyMs = 0;
      let wasmBakeMs = 0;
      let wasmToHostCopyMs = 0;
      let cleanupMs = 0;
      let outputBytes = 0;
      let sourcePointer = 0;
      let requestPointer = 0;
      let responsePointer = 0;
      let responseLength = 0;
      let segmentedResponse = false;
      try {
        phase = performance.now();
        sourcePointer = copyIntoWasm(exports, source, spec.label);
        requestPointer = copyIntoWasm(exports, requestBytes, spec.label);
        wasmInputCopyMs = performance.now() - phase;
        wasmMemoryPeakBytes = Math.max(wasmMemoryPeakBytes, exports.memory.buffer.byteLength);
        phase = performance.now();
        responsePointer = u32(exports.bake(sourcePointer, source.byteLength, requestPointer, requestBytes.byteLength));
        wasmBakeMs = performance.now() - phase;
        wasmMemoryPeakBytes = Math.max(wasmMemoryPeakBytes, exports.memory.buffer.byteLength);
        responseLength = u32(exports.responseLength());
        phase = performance.now();
        let result: RasterBakeArtifact<Kind>;
        if (responsePointer === 0 && responseLength === 0 && exports.segmented !== undefined) {
          segmentedResponse = true;
          result = decodeSegmentedResponse(exports, abi, spec);
        } else {
          const response = memoryRange(exports.memory, responsePointer, responseLength, spec.label);
          result = decodeResponse(response, abi, spec);
        }
        wasmToHostCopyMs = performance.now() - phase;
        outputBytes = result.artifacts.reduce((total, artifact) => total + artifact.bytes.byteLength, 0);
        return result;
      } finally {
        phase = performance.now();
        if (sourcePointer !== 0) exports.deallocate(sourcePointer, source.byteLength);
        if (requestPointer !== 0) exports.deallocate(requestPointer, requestBytes.byteLength);
        if (responsePointer !== 0 && responseLength !== 0) {
          exports.deallocate(responsePointer, responseLength);
        }
        if (segmentedResponse) exports.segmented?.release();
        cleanupMs = performance.now() - phase;
        observeProfile({
          requestEncodingMs,
          wasmInputCopyMs,
          wasmBakeMs,
          wasmToHostCopyMs,
          cleanupMs,
          wasmMemoryBeforeBytes,
          wasmMemoryPeakBytes,
          wasmMemoryAfterBytes: exports.memory.buffer.byteLength,
          outputBytes,
        });
      }
    },
  };
}
