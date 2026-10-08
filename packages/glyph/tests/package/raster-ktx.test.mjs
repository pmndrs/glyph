import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KHR_DF_CHANNEL_RGBSDA_ALPHA,
  KHR_DF_CHANNEL_RGBSDA_BLUE,
  KHR_DF_CHANNEL_RGBSDA_GREEN,
  KHR_DF_CHANNEL_RGBSDA_RED,
  KHR_DF_KHR_DESCRIPTORTYPE_BASICFORMAT,
  KHR_DF_MODEL_RGBSDA,
  KHR_DF_PRIMARIES_BT709,
  KHR_DF_SAMPLE_DATATYPE_FLOAT,
  KHR_DF_SAMPLE_DATATYPE_SIGNED,
  KHR_DF_TRANSFER_LINEAR,
  KHR_DF_VENDORID_KHRONOS,
  KHR_DF_VERSION,
  VK_FORMAT_ASTC_4x4_UNORM_BLOCK,
  VK_FORMAT_BC4_UNORM_BLOCK,
  VK_FORMAT_EAC_R11_UNORM_BLOCK,
  VK_FORMAT_R8_UNORM,
  VK_FORMAT_R8G8B8A8_UNORM,
  VK_FORMAT_R16G16B16A16_SFLOAT,
  createDefaultContainer,
  read as readKtx2Oracle,
  write as writeKtx2,
} from 'ktx-parse';

import { RasterKtxValidationError, validateNativeKtx2 } from '../../dist/internal/raster-ktx.js';

const CHANNELS = [
  KHR_DF_CHANNEL_RGBSDA_RED,
  KHR_DF_CHANNEL_RGBSDA_GREEN,
  KHR_DF_CHANNEL_RGBSDA_BLUE,
  KHR_DF_CHANNEL_RGBSDA_ALPHA,
];

const FORMATS = [
  {
    name: 'R8',
    vkFormat: VK_FORMAT_R8_UNORM,
    typeSize: 1,
    blockWidth: 1,
    blockHeight: 1,
    bytesPerBlock: 1,
    uncompressedChannelTypes: [KHR_DF_CHANNEL_RGBSDA_RED],
  },
  {
    name: 'RGBA8',
    vkFormat: VK_FORMAT_R8G8B8A8_UNORM,
    typeSize: 1,
    blockWidth: 1,
    blockHeight: 1,
    bytesPerBlock: 4,
    uncompressedChannelTypes: CHANNELS,
  },
  {
    name: 'RGBA16F',
    vkFormat: VK_FORMAT_R16G16B16A16_SFLOAT,
    typeSize: 2,
    blockWidth: 1,
    blockHeight: 1,
    bytesPerBlock: 8,
    float16ChannelTypes: CHANNELS,
  },
  {
    name: 'BC4',
    vkFormat: VK_FORMAT_BC4_UNORM_BLOCK,
    typeSize: 1,
    blockWidth: 4,
    blockHeight: 4,
    bytesPerBlock: 8,
  },
  {
    name: 'EAC R11',
    vkFormat: VK_FORMAT_EAC_R11_UNORM_BLOCK,
    typeSize: 1,
    blockWidth: 4,
    blockHeight: 4,
    bytesPerBlock: 8,
  },
  {
    name: 'ASTC 4×4',
    vkFormat: VK_FORMAT_ASTC_4x4_UNORM_BLOCK,
    typeSize: 1,
    blockWidth: 4,
    blockHeight: 4,
    bytesPerBlock: 16,
  },
];

test('reads every supported native format and retains a zero-copy base-level view', () => {
  for (const format of FORMATS) {
    const width = 5;
    const height = 7;
    const bytes = nativeKtx2(width, height, format);
    const backing = new Uint8Array(bytes.byteLength + 7);
    backing.set(bytes, 3);
    const source = backing.subarray(3, 3 + bytes.byteLength);

    const actual = validateNativeKtx2(source, width, height, format);
    const oracle = readKtx2Oracle(source);

    assert.equal(actual.buffer, backing.buffer, format.name);
    assert.equal(actual.byteOffset, oracle.levels[0].levelData.byteOffset, format.name);
    assert.deepEqual(actual, oracle.levels[0].levelData, format.name);
  }
});

test('classifies unsupported native-image header and level variants', () => {
  const format = FORMATS[0];
  const canonical = nativeKtx2(5, 7, format);
  for (const [label, mutate] of [
    ['format', (view) => view.setUint32(12, VK_FORMAT_R8G8B8A8_UNORM, true)],
    ['type size', (view) => view.setUint32(16, 2, true)],
    ['width', (view) => view.setUint32(20, 6, true)],
    ['height', (view) => view.setUint32(24, 8, true)],
    ['depth', (view) => view.setUint32(28, 1, true)],
    ['layers', (view) => view.setUint32(32, 1, true)],
    ['faces', (view) => view.setUint32(36, 6, true)],
    ['supercompression', (view) => view.setUint32(44, 1, true)],
    ['uncompressed length', (view) => view.setBigUint64(96, 34n, true)],
  ]) {
    const bytes = canonical.slice();
    mutate(new DataView(bytes.buffer));
    assertKtxError(() => validateNativeKtx2(bytes, 5, 7, format), 'KTX2_VARIANT', label);
  }

  const multiLevel = nativeKtx2(5, 7, format, {
    levelCount: 2,
    levels: [
      { levelData: new Uint8Array(35), uncompressedByteLength: 35 },
      { levelData: new Uint8Array(6), uncompressedByteLength: 6 },
    ],
  });
  assertKtxError(() => validateNativeKtx2(multiLevel, 5, 7, format), 'KTX2_VARIANT', 'levels');
});

test('rejects malformed, truncated, out-of-range, and unsafe section coordinates', () => {
  const format = FORMATS[0];
  const canonical = nativeKtx2(5, 7, format);
  const oracle = readKtx2Oracle(canonical);
  const levelEnd = oracle.levels[0].levelData.byteOffset + oracle.levels[0].levelData.byteLength;

  for (const length of [0, 11, 79, 103, levelEnd - 1]) {
    assertKtxError(() => validateNativeKtx2(canonical.subarray(0, length), 5, 7, format), 'KTX2_INVALID');
  }

  const badIdentifier = canonical.slice();
  badIdentifier[0] ^= 0xff;
  assertKtxError(() => validateNativeKtx2(badIdentifier, 5, 7, format), 'KTX2_INVALID');

  for (const [label, mutate] of [
    ['unsafe level offset', (view) => view.setUint32(84, 0x20_0000, true)],
    ['out-of-range level', (view) => view.setBigUint64(80, BigInt(canonical.byteLength), true)],
    ['out-of-range DFD', (view) => view.setUint32(48, canonical.byteLength, true)],
    ['out-of-range empty KVD', (view) => view.setUint32(56, canonical.byteLength + 1, true)],
    ['unsafe global offset', (view) => view.setUint32(68, 0x20_0000, true)],
  ]) {
    const bytes = canonical.slice();
    mutate(new DataView(bytes.buffer));
    assertKtxError(() => validateNativeKtx2(bytes, 5, 7, format), 'KTX2_INVALID', label);
  }

  const unsafeSecondLevel = nativeKtx2(5, 7, format, {
    levelCount: 2,
    levels: [
      { levelData: new Uint8Array(35), uncompressedByteLength: 35 },
      { levelData: new Uint8Array(6), uncompressedByteLength: 6 },
    ],
  });
  new DataView(unsafeSecondLevel.buffer).setUint32(108, 0x20_0000, true);
  assertKtxError(() => validateNativeKtx2(unsafeSecondLevel, 5, 7, format), 'KTX2_VARIANT', 'second level');
});

test('separates structural DFD failures from valid but incompatible descriptors', () => {
  const format = FORMATS[1];
  const canonical = nativeKtx2(5, 7, format);
  const header = new DataView(canonical.buffer);
  const dfdByteOffset = header.getUint32(48, true);

  const malformed = canonical.slice();
  new DataView(malformed.buffer).setUint32(dfdByteOffset, header.getUint32(52, true) - 1, true);
  assertKtxError(() => validateNativeKtx2(malformed, 5, 7, format), 'KTX2_INVALID');

  for (const [label, byteOffset] of [
    ['vendor', dfdByteOffset + 4],
    ['descriptor type', dfdByteOffset + 6],
    ['version', dfdByteOffset + 8],
    ['color model', dfdByteOffset + 12],
    ['color primaries', dfdByteOffset + 13],
    ['transfer function', dfdByteOffset + 14],
    ['flags', dfdByteOffset + 15],
    ['texel block dimensions', dfdByteOffset + 16],
    ['bytes plane', dfdByteOffset + 20],
    ['sample bit offset', dfdByteOffset + 28],
    ['sample bit length', dfdByteOffset + 30],
    ['first channel', dfdByteOffset + 31],
    ['sample position', dfdByteOffset + 32],
    ['sample lower', dfdByteOffset + 36],
    ['sample upper', dfdByteOffset + 40],
  ]) {
    const bytes = canonical.slice();
    bytes[byteOffset] ^= 1;
    assertKtxError(() => validateNativeKtx2(bytes, 5, 7, format), 'KTX2_DFD', label);
  }
});

test('rejects bounded key/value and global data as unsupported metadata', () => {
  const format = FORMATS[0];
  const withKeyValue = nativeKtx2(5, 7, format, { keyValue: { author: 'Glyph' } });
  assertKtxError(() => validateNativeKtx2(withKeyValue, 5, 7, format), 'KTX2_METADATA');

  const globalData = {
    endpointCount: 0,
    selectorCount: 0,
    imageDescs: [],
    endpointsData: new Uint8Array(),
    selectorsData: new Uint8Array(),
    tablesData: new Uint8Array(),
    extendedData: new Uint8Array(),
  };
  const withGlobalData = nativeKtx2(5, 7, format, { globalData });
  assertKtxError(() => validateNativeKtx2(withGlobalData, 5, 7, format), 'KTX2_METADATA');
});

function nativeKtx2(width, height, format, overrides = {}) {
  const horizontalBlocks = Math.ceil(width / format.blockWidth);
  const verticalBlocks = Math.ceil(height / format.blockHeight);
  const levelData = new Uint8Array(horizontalBlocks * verticalBlocks * format.bytesPerBlock);
  for (let index = 0; index < levelData.byteLength; index += 1) levelData[index] = index & 0xff;

  const channels = format.uncompressedChannelTypes ?? format.float16ChannelTypes ?? [];
  const float = format.float16ChannelTypes !== undefined;
  const bits = float ? 16 : 8;
  const descriptor = {
    vendorId: KHR_DF_VENDORID_KHRONOS,
    descriptorType: KHR_DF_KHR_DESCRIPTORTYPE_BASICFORMAT,
    versionNumber: KHR_DF_VERSION,
    colorModel: KHR_DF_MODEL_RGBSDA,
    colorPrimaries: KHR_DF_PRIMARIES_BT709,
    transferFunction: KHR_DF_TRANSFER_LINEAR,
    flags: 0,
    texelBlockDimension: [format.blockWidth - 1, format.blockHeight - 1, 0, 0],
    bytesPlane: [format.bytesPerBlock, 0, 0, 0, 0, 0, 0, 0],
    samples: channels.map((channelType, index) => ({
      bitOffset: index * bits,
      bitLength: bits - 1,
      channelType: channelType | (float ? KHR_DF_SAMPLE_DATATYPE_SIGNED | KHR_DF_SAMPLE_DATATYPE_FLOAT : 0),
      samplePosition: [0, 0, 0, 0],
      sampleLower: float ? -1_082_130_432 : 0,
      sampleUpper: float ? 0x3f80_0000 : 255,
    })),
  };
  const container = createDefaultContainer();
  Object.assign(container, {
    vkFormat: format.vkFormat,
    typeSize: format.typeSize,
    pixelWidth: width,
    pixelHeight: height,
    levelCount: 1,
    levels: [{ levelData, uncompressedByteLength: levelData.byteLength }],
    dataFormatDescriptor: [descriptor],
    keyValue: {},
    ...overrides,
  });
  return writeKtx2(container, { keepWriter: true });
}

function assertKtxError(action, reason, label) {
  assert.throws(action, (error) => error instanceof RasterKtxValidationError && error.reason === reason, label);
}
