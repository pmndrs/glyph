import type {
  BakeArtifact,
  Fingerprint,
  RasterBakeArtifact,
  RasterBakeRequest,
  RasterResourceSource,
} from '@pmndrs/glyph';
import { compatibilityFingerprint, fingerprint } from '@pmndrs/glyph';

import {
  GLYPH_EXAMPLE_EXTENSION,
  GLYPH_EXAMPLE_FORMAT_VERSION,
  GLYPH_EXAMPLE_KIND,
  type GlyphExampleDescriptor,
} from './contract.js';

const GLB_MAGIC = 0x4654_6c67;
const JSON_CHUNK = 0x4e4f_534a;
const BIN_CHUNK = 0x004e_4942;
const HEADER = Uint8Array.of(0x47, 0x44, 0x42, GLYPH_EXAMPLE_FORMAT_VERSION);
const GLTF_WITNESS = new Uint8Array(12);

export interface GlyphExampleExtension {
  readonly version: 0;
  readonly rasterKey: string;
  /** The one value this raster and its core font compare to decide they belong together. */
  readonly fingerprint: Fingerprint;
  readonly descriptor: GlyphExampleDescriptor;
  readonly headerBufferView: number;
  readonly records: RasterResourceSource;
  readonly recordStride: 4;
}

export async function bakeGlyphExampleArtifact(
  request: RasterBakeRequest<GlyphExampleDescriptor>,
): Promise<RasterBakeArtifact<typeof GLYPH_EXAMPLE_KIND>> {
  request.signal?.throwIfAborted();
  if (fingerprint.source(request.font.source) !== request.font.sourceFingerprint) {
    throw new TypeError('glyph-example source bytes do not match their stamped fingerprint');
  }
  const records = glyphColorRecords(request.font.glyphCount, request.descriptor.paletteSeed);
  request.signal?.throwIfAborted();
  // A page always travels inside the artifact that declares it.
  const binary = concatenate(GLTF_WITNESS, HEADER, records);
  const recordSource: RasterResourceSource = { type: 'bufferView', bufferView: 2 };
  const extension: GlyphExampleExtension = {
    version: GLYPH_EXAMPLE_FORMAT_VERSION,
    rasterKey: request.rasterKey,
    fingerprint: compatibilityFingerprint({
      glyphCount: request.font.glyphCount,
      glyphIdWidth: 16,
      kind: GLYPH_EXAMPLE_KIND,
      rasterKey: request.rasterKey,
      shaping: request.font.shapingFingerprint,
      source: request.font.sourceFingerprint,
      version: GLYPH_EXAMPLE_FORMAT_VERSION,
    }),
    descriptor: request.descriptor,
    headerBufferView: 1,
    records: recordSource,
    recordStride: 4,
  };
  const document = {
    asset: { generator: '@pmndrs/glyph-example-raster', version: '2.0' },
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: GLTF_WITNESS.byteLength, target: 34962 },
      { buffer: 0, byteOffset: GLTF_WITNESS.byteLength, byteLength: HEADER.byteLength },
      {
        buffer: 0,
        byteOffset: GLTF_WITNESS.byteLength + HEADER.byteLength,
        byteLength: records.byteLength,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 1,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [0, 0, 0],
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 0 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    extensions: { [GLYPH_EXAMPLE_EXTENSION]: extension },
    extensionsUsed: [GLYPH_EXAMPLE_EXTENSION],
  };
  const bytes = encodeGlb(document, binary);
  const artifactFingerprint = fingerprint.artifact(bytes);
  const metadataBytes = HEADER.byteLength + new TextEncoder().encode(JSON.stringify(extension)).byteLength;
  const artifacts: BakeArtifact[] = [
    {
      role: 'raster',
      id: `${request.rasterKey}.glyph-example.glb`,
      bytes,
      fingerprint: artifactFingerprint,
    },
  ];
  request.signal?.throwIfAborted();
  return {
    rasterKey: request.rasterKey,
    kind: GLYPH_EXAMPLE_KIND,
    extension: GLYPH_EXAMPLE_EXTENSION,
    version: GLYPH_EXAMPLE_FORMAT_VERSION,
    artifacts,
    report: {
      metadataBytes,
      serializedBytes: bytes.byteLength,
      gpuBytes: records.byteLength,
      pages: [
        {
          width: request.font.glyphCount,
          height: 1,
          format: 'rgba8unorm',
          gpuBytes: records.byteLength,
          encodedBytes: records.byteLength,
        },
      ],
    },
  };
}

export function isGlyphExampleHeader(bytes: Uint8Array): boolean {
  return bytes.byteLength === HEADER.byteLength && bytes.every((value, index) => value === HEADER[index]);
}

function glyphColorRecords(glyphCount: number, paletteSeed: number): Uint8Array {
  if (!Number.isSafeInteger(glyphCount) || glyphCount < 1 || glyphCount > 0xffff) {
    throw new RangeError('glyph-example glyphCount must be in 1..65535');
  }
  const records = new Uint8Array(glyphCount * 4);
  for (let glyphId = 0; glyphId < glyphCount; glyphId += 1) {
    const mixed = mix32((glyphId + paletteSeed) >>> 0);
    const offset = glyphId * 4;
    records[offset] = 64 + (mixed & 0x7f);
    records[offset + 1] = 64 + ((mixed >>> 8) & 0x7f);
    records[offset + 2] = 64 + ((mixed >>> 16) & 0x7f);
    records[offset + 3] = 255;
  }
  return records;
}

function mix32(value: number): number {
  let mixed = value;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb_352d);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846c_a68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function encodeGlb(document: unknown, binary: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = align4(json.byteLength);
  const binaryLength = align4(binary.byteLength);
  const bytes = new Uint8Array(12 + 8 + jsonLength + 8 + binaryLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(json, 20);
  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, binaryLength, true);
  view.setUint32(binHeader + 4, BIN_CHUNK, true);
  bytes.set(binary, binHeader + 8);
  return bytes;
}

function concatenate(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}
