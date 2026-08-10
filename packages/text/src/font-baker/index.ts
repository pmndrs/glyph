import { FONT_BAKER_VERSION, FONT_FORMAT_VERSION } from './contract.js';
import { fontBakerAbi, type FontBakerAbi } from './generated/font-baker-abi.js';

export { FONT_BAKER_VERSION, FONT_FORMAT_VERSION } from './contract.js';
export { fontBakerAbi } from './generated/font-baker-abi.js';

export interface FontBakeDescriptorV0 {
  readonly formatVersion: 0;
  readonly fontFaceIndex: number;
}

export interface FontBakeRequestV0 {
  readonly source: Uint8Array;
  readonly descriptor: FontBakeDescriptorV0;
}

export interface BakeArtifactV0 {
  readonly role: 'font';
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface BakeWarning {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface ShapingPayloadReportV0 {
  readonly format: 'opentype-sfnt-harfrust-v0';
  readonly sfntDirectoryBytes: number;
  readonly tables: readonly {
    readonly tag: string;
    readonly rawBytes: number;
    readonly paddedBytes: number;
  }[];
  readonly extentsBytes: number;
  readonly extentsAvailabilityBytes: number;
  readonly totalRawBytes: number;
  readonly gzipBytes?: number;
  readonly brotliBytes?: number;
}

export interface FontPayloadReportV0 {
  readonly source: { readonly bytes: number };
  readonly shared: { readonly shaping: ShapingPayloadReportV0 };
  readonly rasters: readonly unknown[];
  readonly containers: readonly {
    readonly artifactId: string;
    readonly role: 'font';
    readonly jsonBytes: number;
    readonly paddingBytes: number;
    readonly totalBytes: number;
  }[];
  readonly transport: readonly {
    readonly artifactId: string;
    readonly format: 'raw' | 'gzip' | 'brotli';
    readonly bytes: number;
  }[];
}

export interface FontBakeResultV0 {
  readonly artifacts: readonly BakeArtifactV0[];
  readonly report: FontPayloadReportV0;
  readonly warnings: readonly BakeWarning[];
}

export interface SerializedBakeError {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export class FontBakeError extends Error {
  readonly code: string;
  readonly path: string | undefined;

  constructor(error: SerializedBakeError) {
    super(error.message);
    this.name = 'FontBakeError';
    this.code = error.code;
    this.path = error.path;
  }
}

export interface FontBakeCore {
  bake(request: FontBakeRequestV0): FontBakeResultV0;
}

export type FontBakerWasmSource = BufferSource | WebAssembly.Module;

export type FontBakerAbiV0 = FontBakerAbi;

interface FontArtifactMetadata {
  readonly role: 'font';
  readonly id: string;
  readonly sha256: string;
}

interface FontResultMetadata {
  readonly artifacts: readonly FontArtifactMetadata[];
  readonly report: FontPayloadReportV0;
  readonly warnings: readonly BakeWarning[];
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function createFontBaker(source: FontBakerWasmSource): Promise<FontBakeCore> {
  const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source);
  const instance = await WebAssembly.instantiate(module, {});
  return createFontBakerFromInstance(instance);
}

export function createFontBakerFromInstance(instance: WebAssembly.Instance): FontBakeCore {
  const exports = readExports(instance.exports, fontBakerAbi);

  return {
    bake({ source, descriptor }) {
      const descriptorBytes = textEncoder.encode(JSON.stringify(descriptor));
      let sourcePointer = 0;
      let descriptorPointer = 0;
      let responsePointer = 0;
      let responseLength = 0;
      try {
        sourcePointer = copyIntoWasm(exports, source);
        descriptorPointer = copyIntoWasm(exports, descriptorBytes);
        responsePointer = exports.pmndrs_font_baker_bake(
          sourcePointer,
          source.byteLength,
          descriptorPointer,
          descriptorBytes.byteLength,
        );
        responseLength = exports.pmndrs_font_baker_result_len();
        const response = new Uint8Array(exports.memory.buffer, responsePointer, responseLength);
        return decodeResponse(response, fontBakerAbi);
      } finally {
        if (sourcePointer !== 0) {
          exports.pmndrs_font_baker_dealloc(sourcePointer, source.byteLength);
        }
        if (descriptorPointer !== 0) {
          exports.pmndrs_font_baker_dealloc(descriptorPointer, descriptorBytes.byteLength);
        }
        if (responsePointer !== 0 && responseLength !== 0) {
          exports.pmndrs_font_baker_dealloc(responsePointer, responseLength);
        }
      }
    },
  };
}

interface FontBakerExports {
  readonly memory: WebAssembly.Memory;
  readonly pmndrs_font_baker_alloc: (length: number) => number;
  readonly pmndrs_font_baker_dealloc: (pointer: number, length: number) => void;
  readonly pmndrs_font_baker_bake: (
    sourcePointer: number,
    sourceLength: number,
    descriptorPointer: number,
    descriptorLength: number,
  ) => number;
  readonly pmndrs_font_baker_result_len: () => number;
}

function readExports(exports: WebAssembly.Exports, abi: FontBakerAbiV0): FontBakerExports {
  const memory = exports[abi.memory];
  const alloc = exports[abi.functions.allocate.export];
  const dealloc = exports[abi.functions.deallocate.export];
  const bake = exports[abi.functions.bake.export];
  const resultLen = exports[abi.functions.responseByteLength.export];
  if (
    !(memory instanceof WebAssembly.Memory) ||
    typeof alloc !== 'function' ||
    typeof dealloc !== 'function' ||
    typeof bake !== 'function' ||
    typeof resultLen !== 'function'
  ) {
    throw new TypeError('invalid @pmndrs/text bake Wasm exports');
  }
  return {
    memory,
    pmndrs_font_baker_alloc: alloc as FontBakerExports['pmndrs_font_baker_alloc'],
    pmndrs_font_baker_dealloc: dealloc as FontBakerExports['pmndrs_font_baker_dealloc'],
    pmndrs_font_baker_bake: bake as FontBakerExports['pmndrs_font_baker_bake'],
    pmndrs_font_baker_result_len: resultLen as FontBakerExports['pmndrs_font_baker_result_len'],
  };
}

function copyIntoWasm(exports: FontBakerExports, bytes: Uint8Array): number {
  const pointer = exports.pmndrs_font_baker_alloc(bytes.byteLength);
  if (pointer === 0 && bytes.byteLength !== 0) {
    throw new RangeError('font baker Wasm allocation failed');
  }
  try {
    new Uint8Array(exports.memory.buffer, pointer, bytes.byteLength).set(bytes);
    return pointer;
  } catch (error) {
    if (pointer !== 0) exports.pmndrs_font_baker_dealloc(pointer, bytes.byteLength);
    throw error;
  }
}

function decodeResponse(bytes: Uint8Array, abi: FontBakerAbiV0): FontBakeResultV0 {
  const response = abi.response;
  if (
    bytes.byteLength < response.headerByteLength ||
    textDecoder.decode(bytes.subarray(response.magicOffset, response.magicOffset + response.magic.length)) !==
      response.magic
  ) {
    throw new TypeError('invalid font baker response envelope');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const status = view.getUint32(response.statusOffset, true);
  const metadataLength = view.getUint32(response.metadataByteLengthOffset, true);
  const artifactLength = view.getUint32(response.artifactByteLengthOffset, true);
  if (response.payloadOffset + metadataLength + artifactLength !== bytes.byteLength) {
    throw new TypeError('invalid font baker response lengths');
  }
  const metadata: unknown = JSON.parse(
    textDecoder.decode(bytes.subarray(response.payloadOffset, response.payloadOffset + metadataLength)),
  );
  if (status !== response.successStatus) {
    throw new FontBakeError(parseSerializedBakeError(metadata));
  }
  assertFontResultMetadata(metadata);
  const result = metadata;
  const artifact = result.artifacts[0];
  if (result.artifacts.length !== 1 || artifact === undefined) {
    throw new TypeError('V0 font baker must return exactly one core artifact');
  }
  const artifactBytes = bytes.slice(response.payloadOffset + metadataLength);
  return {
    artifacts: [{ ...artifact, bytes: artifactBytes }],
    report: result.report,
    warnings: result.warnings,
  };
}

function assertFontResultMetadata(value: unknown): asserts value is FontResultMetadata {
  if (
    !isNonArrayObject(value) ||
    !Array.isArray(value.artifacts) ||
    !value.artifacts.every(isFontArtifactMetadata) ||
    !isFontPayloadReport(value.report) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every(isBakeWarning)
  ) {
    throw new TypeError('font baker returned invalid result metadata');
  }
}

function isFontArtifactMetadata(value: unknown): value is FontArtifactMetadata {
  return (
    isNonArrayObject(value) &&
    value.role === 'font' &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(value.sha256)
  );
}

function isFontPayloadReport(value: unknown): value is FontPayloadReportV0 {
  if (!isNonArrayObject(value)) return false;
  const { source, shared, containers, transport } = value;
  return (
    isNonArrayObject(source) &&
    isNonnegativeSafeInteger(source.bytes) &&
    isNonArrayObject(shared) &&
    isShapingPayloadReport(shared.shaping) &&
    Array.isArray(value.rasters) &&
    Array.isArray(containers) &&
    containers.every(isContainerReport) &&
    Array.isArray(transport) &&
    transport.every(isTransportReport)
  );
}

function isShapingPayloadReport(value: unknown): value is ShapingPayloadReportV0 {
  return (
    isNonArrayObject(value) &&
    value.format === 'opentype-sfnt-harfrust-v0' &&
    isNonnegativeSafeInteger(value.sfntDirectoryBytes) &&
    Array.isArray(value.tables) &&
    value.tables.every(isShapingTableReport) &&
    isNonnegativeSafeInteger(value.extentsBytes) &&
    isNonnegativeSafeInteger(value.extentsAvailabilityBytes) &&
    isNonnegativeSafeInteger(value.totalRawBytes) &&
    (value.gzipBytes === undefined || isNonnegativeSafeInteger(value.gzipBytes)) &&
    (value.brotliBytes === undefined || isNonnegativeSafeInteger(value.brotliBytes))
  );
}

function isShapingTableReport(value: unknown): boolean {
  return (
    isNonArrayObject(value) &&
    typeof value.tag === 'string' &&
    isNonnegativeSafeInteger(value.rawBytes) &&
    isNonnegativeSafeInteger(value.paddedBytes)
  );
}

function isContainerReport(value: unknown): boolean {
  return (
    isNonArrayObject(value) &&
    typeof value.artifactId === 'string' &&
    value.role === 'font' &&
    isNonnegativeSafeInteger(value.jsonBytes) &&
    isNonnegativeSafeInteger(value.paddingBytes) &&
    isNonnegativeSafeInteger(value.totalBytes)
  );
}

function isTransportReport(value: unknown): boolean {
  return (
    isNonArrayObject(value) &&
    typeof value.artifactId === 'string' &&
    (value.format === 'raw' || value.format === 'gzip' || value.format === 'brotli') &&
    isNonnegativeSafeInteger(value.bytes)
  );
}

function isBakeWarning(value: unknown): value is BakeWarning {
  return (
    isNonArrayObject(value) &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    (value.path === undefined || typeof value.path === 'string')
  );
}

function parseSerializedBakeError(value: unknown): SerializedBakeError {
  if (!isBakeWarning(value)) throw new TypeError('font baker returned invalid error metadata');
  return value;
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
