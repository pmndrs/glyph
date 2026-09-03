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
  read as readKtx2,
  type KTX2Container,
  type KTX2DataFormatDescriptorBasicFormat,
} from 'ktx-parse';
import { GlyphError } from '../glyph-error.js';

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
): KTX2Container {
  let container: KTX2Container;
  try {
    container = readKtx2(bytes);
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
  if (Object.keys(container.keyValue).length !== 0 || container.globalData !== null) {
    throw new RasterKtxValidationError('KTX2_METADATA', 'baseline KTX2 pages must not contain auxiliary metadata');
  }
  return container;
}

function isLinearFloat16Descriptor(
  descriptors: readonly KTX2DataFormatDescriptorBasicFormat[],
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
  descriptors: readonly KTX2DataFormatDescriptorBasicFormat[],
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
