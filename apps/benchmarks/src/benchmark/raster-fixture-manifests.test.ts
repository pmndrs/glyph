import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';

import { describe, expect, it } from 'vitest';
import { MSDF_EM_SIZE, MSDF_PIXEL_RANGE } from '@pmndrs/glyph/raster/msdf';

import bitmapManifest from '../../fixtures/rendering/showcase-raster-fixtures-v0.json' with { type: 'json' };
import bitmapDensityManifest from '../../fixtures/rendering/showcase-bitmap-density-fixtures-v0.json' with { type: 'json' };
import mtsdfManifest from '../../fixtures/rendering/showcase-mtsdf-fixtures-v0.json' with { type: 'json' };
import fontAwesomeIcons from '../../fixtures/fonts/font-awesome-free-6.7.2/icons.json' with { type: 'json' };
import { exactBaseTextureArrayBytes } from './texture-memory';

interface FixtureIdentity {
  readonly directory: string;
  readonly glyphCount: number;
}

const fixtureRoot = new URL('../../fixtures/', import.meta.url);
const fixtureIdentities = {
  inter: { directory: 'fonts/inter-v4.1/', glyphCount: 2937 },
  amiri: { directory: 'fonts/amiri-1.002/', glyphCount: 6710 },
  'noto-sans-devanagari': {
    directory: 'fonts/noto-sans-devanagari/',
    glyphCount: 954,
  },
  'dot-gothic-16': { directory: 'fonts/dot-gothic-16/', glyphCount: 9362 },
  'font-awesome-free-6.7.2': {
    directory: 'fonts/font-awesome-free-6.7.2/',
    glyphCount: 1403,
  },
  'noto-sans-cjk-showcase': {
    directory: 'fonts/noto-sans-cjk-showcase-v0/',
    glyphCount: 155,
  },
  'source-serif-4': { directory: 'fonts/source-serif-4.005/', glyphCount: 1464 },
  'dancing-script': { directory: 'fonts/dancing-script-3.000/', glyphCount: 1017 },
} as const satisfies Readonly<Record<string, FixtureIdentity>>;
type FixtureId = keyof typeof fixtureIdentities;

describe('checked raster fixture manifests', () => {
  it('authenticates the complete named Font Awesome Solid catalog', () => {
    expect(fontAwesomeIcons.source).toEqual({
      version: '6.7.2',
      url: 'https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.7.2/metadata/icons.json',
      sha256: 'a3a705d0e03c4fbdf1a61aece3d8fd462024b33794187ef7ee2a0764439170eb',
    });
    expect(fontAwesomeIcons.icons).toHaveLength(1_402);
    expect(new Set(fontAwesomeIcons.icons.map(({ name }) => name)).size).toBe(1_402);
    expect(new Set(fontAwesomeIcons.icons.map(({ codePoint }) => codePoint)).size).toBe(1_402);
  });

  it.each([
    ['single-density', bitmapManifest],
    ['1x/2x density', bitmapDensityManifest],
  ] as const)('authenticates every %s bitmap artifact and page total', async (_name, manifest) => {
    expect(manifest.artifacts.map(({ fontFixture }) => fontFixture)).toEqual(Object.keys(fixtureIdentities));
    for (const artifact of manifest.artifacts) {
      const fixtureId = checkedFixtureId(artifact.fontFixture);
      const identity = fixtureIdentities[fixtureId];
      const bytes = await readFile(new URL(`rendering/${artifact.file}`, fixtureRoot));
      expect(bytes.byteLength).toBe(artifact.bytes);
      expect(sha256(bytes)).toBe(artifact.sha256);
      const document = glbDocument(glbJsonPrefix(bytes), artifact.file);
      await expectCompleteFont(document, identity, fixtureId);
      const raster = objectProperty(
        objectProperty(document, 'extensions', artifact.file),
        'PMNDRS_font_bitmap',
        artifact.file,
      );
      const strikes = arrayProperty(raster, 'strikes', artifact.file);
      expect(strikes).toHaveLength(manifest.strikePpems.length);
      expect(
        strikes.map((value, index) => {
          const strike = objectValue(value, `${artifact.file} bitmap strike ${index}`);
          const ppemX = integerProperty(strike, 'ppemX', artifact.file);
          expect(integerProperty(strike, 'ppemY', artifact.file)).toBe(ppemX);
          return ppemX;
        }),
      ).toEqual(manifest.strikePpems);
      expect(
        sum(
          strikes.map(
            (value, index) =>
              arrayProperty(objectValue(value, `${artifact.file} bitmap strike ${index}`), 'pages', artifact.file)
                .length,
          ),
        ),
      ).toBe(artifact.raster.pages.length);
      expect(sum(artifact.raster.pages.map(({ decodedGpuBytes }) => decodedGpuBytes))).toBe(
        artifact.raster.decodedGpuBytes,
      );
    }
  });

  it('covers every complete MTSDF font fixture', () => {
    expect(mtsdfManifest.artifacts.map(({ fontFixture }) => fontFixture)).toEqual(Object.keys(fixtureIdentities));
  });

  it.each(mtsdfManifest.artifacts)('authenticates MTSDF artifact $fontFixture and its page total', async (artifact) => {
    const fixtureId = checkedFixtureId(artifact.fontFixture);
    const identity = fixtureIdentities[fixtureId];
    const compressed = await readFile(new URL(`rendering/${artifact.file}`, fixtureRoot));
    expect(compressed.byteLength).toBe(artifact.compressed.bytes);
    expect(sha256(compressed)).toBe(artifact.compressed.sha256);
    const expanded = await authenticateGzipGlb(compressed);
    expect(expanded.bytes).toBe(artifact.uncompressed.bytes);
    expect(expanded.sha256).toBe(artifact.uncompressed.sha256);
    const document = glbDocument(expanded.jsonPrefix, artifact.file);
    await expectCompleteFont(document, identity, fixtureId);
    const raster = objectProperty(
      objectProperty(document, 'extensions', artifact.file),
      'PMNDRS_font_distance_field',
      artifact.file,
    );
    expect(artifact.configuration).toEqual({ emSize: MSDF_EM_SIZE, pixelRange: MSDF_PIXEL_RANGE });
    expect(integerProperty(raster, 'emSize', artifact.file)).toBe(artifact.configuration.emSize);
    expect(integerProperty(raster, 'planeUnitsPerEm', artifact.file)).toBe(artifact.configuration.emSize);
    expect(integerProperty(raster, 'pixelRange', artifact.file)).toBe(artifact.configuration.pixelRange);
    expect(arrayProperty(raster, 'pages', artifact.file)).toHaveLength(artifact.raster.pages.length);
    expect(sum(artifact.raster.pages.map(({ decodedGpuBytes }) => decodedGpuBytes))).toBe(
      artifact.raster.decodedGpuBytes,
    );
    const textureArray = artifact.raster.runtimeTextureArray;
    expect(exactBaseTextureArrayBytes(textureArray.width, textureArray.height, textureArray.layers, 4)).toBe(
      textureArray.basePaddedGpuBytes,
    );
  });
});

async function expectCompleteFont(
  document: Record<string, unknown>,
  identity: FixtureIdentity,
  fixtureId: FixtureId,
): Promise<void> {
  const sourceManifest = JSON.parse(
    await readFile(new URL(`${identity.directory}manifest.json`, fixtureRoot), 'utf8'),
  ) as { readonly source: { readonly fontFingerprint: string } };
  const font = objectProperty(objectProperty(document, 'extensions', fixtureId), 'PMNDRS_font', fixtureId);
  const metrics = objectProperty(font, 'metrics', fixtureId);
  const provenance = objectProperty(font, 'provenance', fixtureId);
  expect(integerProperty(metrics, 'glyphCount', fixtureId)).toBe(identity.glyphCount);
  expect(stringProperty(provenance, 'sourceFingerprint', fixtureId)).toBe(sourceManifest.source.fontFingerprint);
  expect(integerProperty(provenance, 'fontFaceIndex', fixtureId)).toBe(0);
}

async function authenticateGzipGlb(
  compressed: Uint8Array,
): Promise<{ readonly bytes: number; readonly sha256: string; readonly jsonPrefix: Buffer }> {
  const gunzip = createGunzip();
  gunzip.end(compressed);
  const hash = createHash('sha256');
  let bytes = 0;
  let prefix = Buffer.alloc(0);
  let requiredPrefixBytes = 20;
  for await (const chunkValue of gunzip) {
    const chunk = Buffer.from(chunkValue);
    hash.update(chunk);
    bytes += chunk.byteLength;
    let chunkOffset = 0;
    while (chunkOffset < chunk.byteLength && prefix.byteLength < requiredPrefixBytes) {
      const copyBytes = Math.min(chunk.byteLength - chunkOffset, requiredPrefixBytes - prefix.byteLength);
      prefix = Buffer.concat([prefix, chunk.subarray(chunkOffset, chunkOffset + copyBytes)]);
      chunkOffset += copyBytes;
      if (prefix.byteLength >= 20 && requiredPrefixBytes === 20) {
        requiredPrefixBytes = checkedJsonPrefixLength(prefix);
      }
    }
  }
  if (prefix.byteLength !== requiredPrefixBytes) throw new Error('gzip GLB ended before JSON chunk');
  return { bytes, sha256: hash.digest('hex'), jsonPrefix: prefix };
}

function glbJsonPrefix(bytes: Buffer): Buffer {
  const requiredBytes = checkedJsonPrefixLength(bytes);
  if (bytes.byteLength < requiredBytes) throw new Error('GLB ended before JSON chunk');
  return bytes.subarray(0, requiredBytes);
}

function checkedJsonPrefixLength(bytes: Uint8Array): number {
  if (bytes.byteLength < 20) throw new Error('GLB header is truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x4654_6c67) throw new Error('GLB magic is invalid');
  if (view.getUint32(4, true) !== 2) throw new Error('GLB version is not 2');
  if (view.getUint32(16, true) !== 0x4e4f_534a) throw new Error('GLB first chunk is not JSON');
  const requiredBytes = 20 + view.getUint32(12, true);
  if (!Number.isSafeInteger(requiredBytes)) throw new Error('GLB JSON chunk length is unsafe');
  return requiredBytes;
}

function glbDocument(prefix: Uint8Array, name: string): Record<string, unknown> {
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  const jsonBytes = prefix.subarray(20, 20 + view.getUint32(12, true));
  return objectValue(JSON.parse(new TextDecoder().decode(jsonBytes).trimEnd()), `${name} JSON`);
}

function checkedFixtureId(value: string): FixtureId {
  if (!Object.hasOwn(fixtureIdentities, value)) throw new Error(`Unknown font fixture: ${value}`);
  return value as FixtureId;
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function objectProperty(
  value: Readonly<Record<string, unknown>>,
  property: string,
  name: string,
): Record<string, unknown> {
  return objectValue(value[property], `${name}.${property}`);
}

function arrayProperty(value: Readonly<Record<string, unknown>>, property: string, name: string): readonly unknown[] {
  const result = value[property];
  if (!Array.isArray(result)) throw new TypeError(`${name}.${property} must be an array`);
  return result;
}

function integerProperty(value: Readonly<Record<string, unknown>>, property: string, name: string): number {
  const result = value[property];
  if (!Number.isSafeInteger(result)) throw new TypeError(`${name}.${property} must be an integer`);
  return result as number;
}

function stringProperty(value: Readonly<Record<string, unknown>>, property: string, name: string): string {
  const result = value[property];
  if (typeof result !== 'string') throw new TypeError(`${name}.${property} must be a string`);
  return result;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
