import {
  KHR_DF_KHR_DESCRIPTORTYPE_BASICFORMAT,
  KHR_DF_MODEL_RGBSDA,
  KHR_DF_PRIMARIES_BT709,
  KHR_DF_SAMPLE_DATATYPE_FLOAT,
  KHR_DF_SAMPLE_DATATYPE_SIGNED,
  KHR_DF_TRANSFER_LINEAR,
  KHR_DF_VENDORID_KHRONOS,
  KHR_DF_VERSION,
  KHR_SUPERCOMPRESSION_NONE,
} from './ktx2-constants.js';
import { GlyphError } from '../glyph-error.js';

const KTX2_IDENTIFIER = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEADER_BYTE_LENGTH = 80;
const LEVEL_INDEX_ENTRY_BYTE_LENGTH = 24;
const BASIC_DFD_BYTE_LENGTH = 24;
const BASIC_DFD_SAMPLE_BYTE_LENGTH = 16;

interface Ktx2BasicFormatSample {
  readonly bitOffset: number;
  readonly bitLength: number;
  readonly channelType: number;
  readonly samplePosition: readonly number[];
  readonly sampleLower: number;
  readonly sampleUpper: number;
}

interface Ktx2DataFormatDescriptorBasicFormat {
  readonly vendorId: number;
  readonly descriptorType: number;
  readonly versionNumber: number;
  readonly colorModel: number;
  readonly colorPrimaries: number;
  readonly transferFunction: number;
  readonly flags: number;
  readonly texelBlockDimension: readonly number[];
  readonly bytesPlane: readonly number[];
  readonly samples: readonly Ktx2BasicFormatSample[];
}

export interface NativeKtx2Container {
  readonly vkFormat: number;
  readonly typeSize: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly pixelDepth: number;
  readonly layerCount: number;
  readonly faceCount: number;
  readonly levelCount: number;
  readonly supercompressionScheme: number;
  readonly levels: readonly {
    readonly levelData: Uint8Array;
    readonly uncompressedByteLength: number;
  }[];
  readonly dataFormatDescriptor: readonly Ktx2DataFormatDescriptorBasicFormat[];
  readonly keyValueDataByteLength: number;
  readonly globalDataByteLength: number;
}

export type RasterKtxValidationErrorCode = 'KTX2_INVALID' | 'KTX2_VARIANT' | 'KTX2_DFD' | 'KTX2_METADATA';

export class RasterKtxValidationError extends GlyphError<'artifact-invalid'> {
  readonly reason: RasterKtxValidationErrorCode;

  constructor(code: RasterKtxValidationErrorCode, message: string, options?: ErrorOptions) {
    super('artifact-invalid', message, options);
    this.name = 'RasterKtxValidationError';
    this.reason = code;
  }
}

export interface NativeKtx2Format {
  readonly vkFormat: number;
  readonly typeSize?: number;
  readonly blockWidth: number;
  readonly blockHeight: number;
  readonly bytesPerBlock: number;
  readonly uncompressedChannelTypes?: readonly number[];
  readonly float16ChannelTypes?: readonly number[];
}

export function validateNativeKtx2(
  bytes: Uint8Array,
  width: number,
  height: number,
  format: NativeKtx2Format,
): NativeKtx2Container {
  let container: NativeKtx2Container;
  try {
    container = readNativeKtx2(bytes);
  } catch (error) {
    throw new RasterKtxValidationError('KTX2_INVALID', error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
  const horizontalBlocks = Math.ceil(width / format.blockWidth);
  const verticalBlocks = Math.ceil(height / format.blockHeight);
  const expectedBytes = horizontalBlocks * verticalBlocks * format.bytesPerBlock;
  if (!Number.isSafeInteger(expectedBytes)) {
    throw new RasterKtxValidationError('KTX2_VARIANT', 'KTX2 payload size overflowed');
  }
  if (
    container.vkFormat !== format.vkFormat ||
    container.typeSize !== (format.typeSize ?? 1) ||
    container.pixelWidth !== width ||
    container.pixelHeight !== height ||
    container.pixelDepth !== 0 ||
    container.layerCount !== 0 ||
    container.faceCount !== 1 ||
    container.levelCount !== 1 ||
    container.supercompressionScheme !== KHR_SUPERCOMPRESSION_NONE ||
    container.levels.length !== 1 ||
    container.levels[0]?.levelData.byteLength !== expectedBytes ||
    container.levels[0]?.uncompressedByteLength !== expectedBytes
  ) {
    throw new RasterKtxValidationError(
      'KTX2_VARIANT',
      'KTX2 must be an uncompressed single-level native image matching its declared dimensions and GPU format',
    );
  }
  if (
    format.uncompressedChannelTypes !== undefined &&
    !isLinearUnormDescriptor(container.dataFormatDescriptor, format.bytesPerBlock, format.uncompressedChannelTypes)
  ) {
    throw new RasterKtxValidationError(
      'KTX2_DFD',
      'KTX2 data format descriptor does not match its linear UNORM channels',
    );
  }
  if (
    format.float16ChannelTypes !== undefined &&
    !isLinearFloat16Descriptor(container.dataFormatDescriptor, format.float16ChannelTypes)
  ) {
    throw new RasterKtxValidationError(
      'KTX2_DFD',
      'KTX2 data format descriptor does not match its linear signed float16 channels',
    );
  }
  if (container.keyValueDataByteLength !== 0 || container.globalDataByteLength !== 0) {
    throw new RasterKtxValidationError('KTX2_METADATA', 'baseline KTX2 pages must not contain auxiliary metadata');
  }
  return container;
}

function isLinearFloat16Descriptor(
  descriptors: readonly Ktx2DataFormatDescriptorBasicFormat[],
  channelTypes: readonly number[],
): boolean {
  const descriptor = descriptors.length === 1 ? descriptors[0] : undefined;
  if (
    descriptor === undefined ||
    descriptor.vendorId !== KHR_DF_VENDORID_KHRONOS ||
    descriptor.descriptorType !== KHR_DF_KHR_DESCRIPTORTYPE_BASICFORMAT ||
    descriptor.versionNumber !== KHR_DF_VERSION ||
    descriptor.colorModel !== KHR_DF_MODEL_RGBSDA ||
    descriptor.colorPrimaries !== KHR_DF_PRIMARIES_BT709 ||
    descriptor.transferFunction !== KHR_DF_TRANSFER_LINEAR ||
    descriptor.flags !== 0 ||
    !equalNumbers(descriptor.texelBlockDimension, [0, 0, 0, 0]) ||
    !equalNumbers(descriptor.bytesPlane, [8, 0, 0, 0, 0, 0, 0, 0]) ||
    descriptor.samples.length !== channelTypes.length
  ) {
    return false;
  }
  const qualifiers = KHR_DF_SAMPLE_DATATYPE_SIGNED | KHR_DF_SAMPLE_DATATYPE_FLOAT;
  return descriptor.samples.every(
    (sample, index) =>
      sample.bitOffset === index * 16 &&
      sample.bitLength === 15 &&
      sample.channelType === (channelTypes[index]! | qualifiers) &&
      equalNumbers(sample.samplePosition, [0, 0, 0, 0]) &&
      sample.sampleLower === -1_082_130_432 &&
      sample.sampleUpper === 0x3f80_0000,
  );
}

function isLinearUnormDescriptor(
  descriptors: readonly Ktx2DataFormatDescriptorBasicFormat[],
  bytesPerTexel: number,
  channelTypes: readonly number[],
): boolean {
  const descriptor = descriptors.length === 1 ? descriptors[0] : undefined;
  if (
    descriptor === undefined ||
    descriptor.vendorId !== KHR_DF_VENDORID_KHRONOS ||
    descriptor.descriptorType !== KHR_DF_KHR_DESCRIPTORTYPE_BASICFORMAT ||
    descriptor.versionNumber !== KHR_DF_VERSION ||
    descriptor.colorModel !== KHR_DF_MODEL_RGBSDA ||
    descriptor.colorPrimaries !== KHR_DF_PRIMARIES_BT709 ||
    descriptor.transferFunction !== KHR_DF_TRANSFER_LINEAR ||
    descriptor.flags !== 0 ||
    !equalNumbers(descriptor.texelBlockDimension, [0, 0, 0, 0]) ||
    !equalNumbers(descriptor.bytesPlane, [bytesPerTexel, 0, 0, 0, 0, 0, 0, 0]) ||
    descriptor.samples.length !== channelTypes.length
  ) {
    return false;
  }
  return descriptor.samples.every(
    (sample, index) =>
      sample.bitOffset === index * 8 &&
      sample.bitLength === 7 &&
      sample.channelType === channelTypes[index] &&
      equalNumbers(sample.samplePosition, [0, 0, 0, 0]) &&
      sample.sampleLower === 0 &&
      sample.sampleUpper === 255,
  );
}

function equalNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readNativeKtx2(bytes: Uint8Array): NativeKtx2Container {
  if (bytes.byteLength < HEADER_BYTE_LENGTH) throw new RangeError('KTX2 header is truncated');
  for (let index = 0; index < KTX2_IDENTIFIER.byteLength; index += 1) {
    if (bytes[index] !== KTX2_IDENTIFIER[index]) throw new Error('Missing KTX 2.0 identifier.');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const levelCount = view.getUint32(40, true);
  const levels = readLevelIndex(bytes, view, levelCount);

  const dfdByteOffset = view.getUint32(48, true);
  const dfdByteLength = view.getUint32(52, true);
  assertByteRange(bytes, dfdByteOffset, dfdByteLength, 'KTX2 data format descriptor');

  const keyValueDataByteOffset = view.getUint32(56, true);
  const keyValueDataByteLength = view.getUint32(60, true);
  assertByteRange(bytes, keyValueDataByteOffset, keyValueDataByteLength, 'KTX2 key/value data');

  const globalDataByteOffset = readSafeUint64(view, 64, 'KTX2 global data byte offset');
  const globalDataByteLength = readSafeUint64(view, 72, 'KTX2 global data byte length');
  if (globalDataByteLength !== 0) {
    assertByteRange(bytes, globalDataByteOffset, globalDataByteLength, 'KTX2 global data');
  }

  return {
    vkFormat: view.getUint32(12, true),
    typeSize: view.getUint32(16, true),
    pixelWidth: view.getUint32(20, true),
    pixelHeight: view.getUint32(24, true),
    pixelDepth: view.getUint32(28, true),
    layerCount: view.getUint32(32, true),
    faceCount: view.getUint32(36, true),
    levelCount,
    supercompressionScheme: view.getUint32(44, true),
    levels,
    dataFormatDescriptor: [readBasicFormatDescriptor(view, dfdByteOffset, dfdByteLength)],
    keyValueDataByteLength,
    globalDataByteLength,
  };
}

function readLevelIndex(bytes: Uint8Array, view: DataView, levelCount: number): NativeKtx2Container['levels'] {
  const indexCount = Math.max(levelCount, 1);
  assertByteRange(bytes, HEADER_BYTE_LENGTH, indexCount * LEVEL_INDEX_ENTRY_BYTE_LENGTH, 'KTX2 level index');

  let baseLevel: NativeKtx2Container['levels'][number] | undefined;
  for (let index = 0; index < indexCount; index += 1) {
    const indexByteOffset = HEADER_BYTE_LENGTH + index * LEVEL_INDEX_ENTRY_BYTE_LENGTH;
    const levelByteOffset = readSafeUint64(view, indexByteOffset, `KTX2 level ${index} byte offset`);
    const levelByteLength = readSafeUint64(view, indexByteOffset + 8, `KTX2 level ${index} byte length`);
    const uncompressedByteLength = readSafeUint64(
      view,
      indexByteOffset + 16,
      `KTX2 level ${index} uncompressed byte length`,
    );
    assertByteRange(bytes, levelByteOffset, levelByteLength, `KTX2 level ${index}`);
    if (index === 0) {
      baseLevel = {
        levelData: bytes.subarray(levelByteOffset, levelByteOffset + levelByteLength),
        uncompressedByteLength,
      };
    }
  }
  return [baseLevel!];
}

function readBasicFormatDescriptor(
  view: DataView,
  byteOffset: number,
  byteLength: number,
): Ktx2DataFormatDescriptorBasicFormat {
  if (byteLength < 4 + BASIC_DFD_BYTE_LENGTH) throw new RangeError('KTX2 data format descriptor is truncated');
  const totalByteLength = view.getUint32(byteOffset, true);
  const descriptorByteOffset = byteOffset + 4;
  const descriptorByteLength = view.getUint16(descriptorByteOffset + 6, true);
  if (
    totalByteLength !== byteLength ||
    descriptorByteLength < BASIC_DFD_BYTE_LENGTH ||
    descriptorByteLength % 4 !== 0 ||
    descriptorByteLength + 4 !== byteLength ||
    (descriptorByteLength - BASIC_DFD_BYTE_LENGTH) % BASIC_DFD_SAMPLE_BYTE_LENGTH !== 0
  ) {
    throw new Error('KTX2 data format descriptor has an invalid size');
  }

  const samples: Ktx2BasicFormatSample[] = [];
  const sampleCount = (descriptorByteLength - BASIC_DFD_BYTE_LENGTH) / BASIC_DFD_SAMPLE_BYTE_LENGTH;
  for (let index = 0; index < sampleCount; index += 1) {
    const sampleByteOffset = descriptorByteOffset + BASIC_DFD_BYTE_LENGTH + index * BASIC_DFD_SAMPLE_BYTE_LENGTH;
    const channelType = view.getUint8(sampleByteOffset + 3);
    const signed = (channelType & KHR_DF_SAMPLE_DATATYPE_SIGNED) !== 0;
    samples.push({
      bitOffset: view.getUint16(sampleByteOffset, true),
      bitLength: view.getUint8(sampleByteOffset + 2),
      channelType,
      samplePosition: [
        view.getUint8(sampleByteOffset + 4),
        view.getUint8(sampleByteOffset + 5),
        view.getUint8(sampleByteOffset + 6),
        view.getUint8(sampleByteOffset + 7),
      ],
      sampleLower: signed ? view.getInt32(sampleByteOffset + 8, true) : view.getUint32(sampleByteOffset + 8, true),
      sampleUpper: signed ? view.getInt32(sampleByteOffset + 12, true) : view.getUint32(sampleByteOffset + 12, true),
    });
  }

  return {
    vendorId: view.getUint16(descriptorByteOffset, true),
    descriptorType: view.getUint16(descriptorByteOffset + 2, true),
    versionNumber: view.getUint16(descriptorByteOffset + 4, true),
    colorModel: view.getUint8(descriptorByteOffset + 8),
    colorPrimaries: view.getUint8(descriptorByteOffset + 9),
    transferFunction: view.getUint8(descriptorByteOffset + 10),
    flags: view.getUint8(descriptorByteOffset + 11),
    texelBlockDimension: [
      view.getUint8(descriptorByteOffset + 12),
      view.getUint8(descriptorByteOffset + 13),
      view.getUint8(descriptorByteOffset + 14),
      view.getUint8(descriptorByteOffset + 15),
    ],
    bytesPlane: [
      view.getUint8(descriptorByteOffset + 16),
      view.getUint8(descriptorByteOffset + 17),
      view.getUint8(descriptorByteOffset + 18),
      view.getUint8(descriptorByteOffset + 19),
      view.getUint8(descriptorByteOffset + 20),
      view.getUint8(descriptorByteOffset + 21),
      view.getUint8(descriptorByteOffset + 22),
      view.getUint8(descriptorByteOffset + 23),
    ],
    samples,
  };
}

function readSafeUint64(view: DataView, byteOffset: number, label: string): number {
  const value = view.getBigUint64(byteOffset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${label} exceeds the safe integer range`);
  return Number(value);
}

function assertByteRange(bytes: Uint8Array, byteOffset: number, byteLength: number, label: string): void {
  if (
    !Number.isSafeInteger(byteOffset) ||
    !Number.isSafeInteger(byteLength) ||
    byteOffset < 0 ||
    byteLength < 0 ||
    byteOffset > bytes.byteLength ||
    byteLength > bytes.byteLength - byteOffset
  ) {
    throw new RangeError(`${label} is outside the KTX2 payload`);
  }
}
