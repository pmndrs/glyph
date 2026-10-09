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

const HEADER_BYTE_LENGTH = 80;
const LEVEL_INDEX_ENTRY_BYTE_LENGTH = 24;
const BASIC_DFD_BYTE_LENGTH = 24;
const BASIC_DFD_SAMPLE_BYTE_LENGTH = 16;
const KTX2_IDENTIFIER_WORD_0 = 0x5854_4bab;
const KTX2_IDENTIFIER_WORD_1 = 0xbb30_3220;
const KTX2_IDENTIFIER_WORD_2 = 0x0a1a_0a0d;
const FLOAT32_NEGATIVE_ONE_BITS = -1_082_130_432;
const FLOAT32_ONE_BITS = 0x3f80_0000;
const MAX_SAFE_UINT64_HIGH_WORD = 0x1f_ffff;

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
): Uint8Array {
  try {
    if (bytes.byteLength < HEADER_BYTE_LENGTH) throw new RangeError('KTX2 header is truncated');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      view.getUint32(0, true) !== KTX2_IDENTIFIER_WORD_0 ||
      view.getUint32(4, true) !== KTX2_IDENTIFIER_WORD_1 ||
      view.getUint32(8, true) !== KTX2_IDENTIFIER_WORD_2
    ) {
      throw new Error('Missing KTX 2.0 identifier.');
    }

    const horizontalBlocks = Math.ceil(width / format.blockWidth);
    const verticalBlocks = Math.ceil(height / format.blockHeight);
    const expectedBytes = horizontalBlocks * verticalBlocks * format.bytesPerBlock;
    if (!Number.isSafeInteger(expectedBytes)) {
      throw new RasterKtxValidationError('KTX2_VARIANT', 'KTX2 payload size overflowed');
    }
    if (
      view.getUint32(12, true) !== format.vkFormat ||
      view.getUint32(16, true) !== (format.typeSize ?? 1) ||
      view.getUint32(20, true) !== width ||
      view.getUint32(24, true) !== height ||
      view.getUint32(28, true) !== 0 ||
      view.getUint32(32, true) !== 0 ||
      view.getUint32(36, true) !== 1 ||
      view.getUint32(40, true) !== 1 ||
      view.getUint32(44, true) !== KHR_SUPERCOMPRESSION_NONE
    ) {
      throw new RasterKtxValidationError(
        'KTX2_VARIANT',
        'KTX2 must be an uncompressed single-level native image matching its declared dimensions and GPU format',
      );
    }

    assertByteRange(bytes, HEADER_BYTE_LENGTH, LEVEL_INDEX_ENTRY_BYTE_LENGTH, 'KTX2 level index');
    const levelByteOffset = readSafeUint64(view, HEADER_BYTE_LENGTH, 'KTX2 level 0 byte offset');
    const levelByteLength = readSafeUint64(view, HEADER_BYTE_LENGTH + 8, 'KTX2 level 0 byte length');
    const uncompressedByteLength = readSafeUint64(
      view,
      HEADER_BYTE_LENGTH + 16,
      'KTX2 level 0 uncompressed byte length',
    );
    assertByteRange(bytes, levelByteOffset, levelByteLength, 'KTX2 level 0');
    if (levelByteLength !== expectedBytes || uncompressedByteLength !== expectedBytes) {
      throw new RasterKtxValidationError(
        'KTX2_VARIANT',
        'KTX2 must be an uncompressed single-level native image matching its declared dimensions and GPU format',
      );
    }

    const dfdByteOffset = view.getUint32(48, true);
    const dfdByteLength = view.getUint32(52, true);
    assertByteRange(bytes, dfdByteOffset, dfdByteLength, 'KTX2 data format descriptor');
    const descriptorByteOffset = readBasicDescriptorOffset(view, dfdByteOffset, dfdByteLength);

    const keyValueDataByteOffset = view.getUint32(56, true);
    const keyValueDataByteLength = view.getUint32(60, true);
    assertByteRange(bytes, keyValueDataByteOffset, keyValueDataByteLength, 'KTX2 key/value data');
    const globalDataByteOffset = readSafeUint64(view, 64, 'KTX2 global data byte offset');
    const globalDataByteLength = readSafeUint64(view, 72, 'KTX2 global data byte length');
    if (globalDataByteLength !== 0) {
      assertByteRange(bytes, globalDataByteOffset, globalDataByteLength, 'KTX2 global data');
    }

    if (
      format.uncompressedChannelTypes !== undefined &&
      !matchesBasicDescriptor(view, descriptorByteOffset, format.bytesPerBlock, format.uncompressedChannelTypes, false)
    ) {
      throw new RasterKtxValidationError(
        'KTX2_DFD',
        'KTX2 data format descriptor does not match its linear UNORM channels',
      );
    }
    if (
      format.float16ChannelTypes !== undefined &&
      !matchesBasicDescriptor(view, descriptorByteOffset, 8, format.float16ChannelTypes, true)
    ) {
      throw new RasterKtxValidationError(
        'KTX2_DFD',
        'KTX2 data format descriptor does not match its linear signed float16 channels',
      );
    }
    if (keyValueDataByteLength !== 0 || globalDataByteLength !== 0) {
      throw new RasterKtxValidationError('KTX2_METADATA', 'baseline KTX2 pages must not contain auxiliary metadata');
    }
    return bytes.subarray(levelByteOffset, levelByteOffset + levelByteLength);
  } catch (error) {
    if (error instanceof RasterKtxValidationError) throw error;
    throw new RasterKtxValidationError('KTX2_INVALID', error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }
}

function readBasicDescriptorOffset(view: DataView, byteOffset: number, byteLength: number): number {
  if (byteLength < 4 + BASIC_DFD_BYTE_LENGTH) throw new RangeError('KTX2 data format descriptor is truncated');
  const descriptorByteOffset = byteOffset + 4;
  const descriptorByteLength = view.getUint16(descriptorByteOffset + 6, true);
  if (
    view.getUint32(byteOffset, true) !== byteLength ||
    descriptorByteLength < BASIC_DFD_BYTE_LENGTH ||
    descriptorByteLength + 4 !== byteLength ||
    (descriptorByteLength - BASIC_DFD_BYTE_LENGTH) % BASIC_DFD_SAMPLE_BYTE_LENGTH !== 0
  ) {
    throw new Error('KTX2 data format descriptor has an invalid size');
  }
  return descriptorByteOffset;
}

function matchesBasicDescriptor(
  view: DataView,
  byteOffset: number,
  bytesPerTexel: number,
  channelTypes: readonly number[],
  float16: boolean,
): boolean {
  if (
    view.getUint16(byteOffset, true) !== KHR_DF_VENDORID_KHRONOS ||
    view.getUint16(byteOffset + 2, true) !== KHR_DF_KHR_DESCRIPTORTYPE_BASICFORMAT ||
    view.getUint16(byteOffset + 4, true) !== KHR_DF_VERSION ||
    view.getUint16(byteOffset + 6, true) !==
      BASIC_DFD_BYTE_LENGTH + channelTypes.length * BASIC_DFD_SAMPLE_BYTE_LENGTH ||
    view.getUint8(byteOffset + 8) !== KHR_DF_MODEL_RGBSDA ||
    view.getUint8(byteOffset + 9) !== KHR_DF_PRIMARIES_BT709 ||
    view.getUint8(byteOffset + 10) !== KHR_DF_TRANSFER_LINEAR ||
    view.getUint8(byteOffset + 11) !== 0 ||
    view.getUint32(byteOffset + 12, true) !== 0 ||
    view.getUint8(byteOffset + 16) !== bytesPerTexel
  ) {
    return false;
  }
  for (let index = 1; index < 8; index += 1) {
    if (view.getUint8(byteOffset + 16 + index) !== 0) return false;
  }

  const bits = float16 ? 16 : 8;
  const qualifiers = float16 ? KHR_DF_SAMPLE_DATATYPE_SIGNED | KHR_DF_SAMPLE_DATATYPE_FLOAT : 0;
  for (let index = 0; index < channelTypes.length; index += 1) {
    const sampleByteOffset = byteOffset + BASIC_DFD_BYTE_LENGTH + index * BASIC_DFD_SAMPLE_BYTE_LENGTH;
    if (
      view.getUint16(sampleByteOffset, true) !== index * bits ||
      view.getUint8(sampleByteOffset + 2) !== bits - 1 ||
      view.getUint8(sampleByteOffset + 3) !== (channelTypes[index]! | qualifiers) ||
      view.getUint32(sampleByteOffset + 4, true) !== 0 ||
      (float16 ? view.getInt32(sampleByteOffset + 8, true) : view.getUint32(sampleByteOffset + 8, true)) !==
        (float16 ? FLOAT32_NEGATIVE_ONE_BITS : 0) ||
      (float16 ? view.getInt32(sampleByteOffset + 12, true) : view.getUint32(sampleByteOffset + 12, true)) !==
        (float16 ? FLOAT32_ONE_BITS : 255)
    ) {
      return false;
    }
  }
  return true;
}

function readSafeUint64(view: DataView, byteOffset: number, label: string): number {
  const low = view.getUint32(byteOffset, true);
  const high = view.getUint32(byteOffset + 4, true);
  if (high > MAX_SAFE_UINT64_HIGH_WORD) throw new RangeError(`${label} exceeds the safe integer range`);
  return high * 0x1_0000_0000 + low;
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
