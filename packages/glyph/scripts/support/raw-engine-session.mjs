import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

import { validateFontArtifact } from '@pmndrs/glyph/bake';

import { validateBitmapArtifact } from '../../dist/bakers/bitmap-validator.js';
import { validateMsdfArtifact } from '../../dist/bakers/msdf-validator.js';
import { validateSlugArtifact } from '../../dist/bakers/slug-validator.js';
import { bitmapDescriptor } from '../../dist/internal/bitmap-contract.js';
import { msdfDescriptor } from '../../dist/internal/msdf-contract.js';
import { slugDescriptor } from '../../dist/internal/slug-contract.js';
import { textShaperAbi as abi } from '../../dist/text-shaper-abi.js';
import { copyIntoAllocation, engineFrameUpdateBytes } from '../../tests/support/engine-abi.mjs';
import { paragraphTextForGlyphs } from './paragraph-benchmark-fixture.mts';
import { techniqueProof } from './render-technique-proof.mjs';
import {
  assertRustLayoutBenchmarkResult,
  rustLayoutBenchmarkCases,
  rustLayoutBenchmarkGeometry,
  rustLayoutBenchmarkInitialGeometry,
} from './rust-layout-benchmark-cases.mjs';

const rootId = 1;
const codecHandle = 1;
const fontHandle = 1;
const fontStackHandle = 1;

export function rawEngineCases(corpus) {
  return rustLayoutBenchmarkCases(corpus);
}

export async function createRawEngineSession({ techniqueName = 'bitmap', corpus = 'latin', glyphs = 22_000 } = {}) {
  const [wasm, artifact] = await Promise.all([
    readFile(new URL('../../dist/text-shaper.wasm', import.meta.url)),
    loadArtifact(techniqueName, corpus),
  ]);
  const validated = await validateFontArtifact(artifact);
  const raster = await validateRaster(techniqueName, artifact, validated);
  const technique = techniqueProof(abi, techniqueName, raster);
  const outputCapacity = technique.outputBytesPerGlyph > 48 ? 8 * 1024 * 1024 : 4 * 1024 * 1024;
  const instance = await WebAssembly.instantiate(await WebAssembly.compile(wasm), {});
  const memory = instance.exports[abi.memory];
  const fn = Object.fromEntries(
    Object.entries(abi.functions).map(([name, exported]) => [name, instance.exports[exported]]),
  );
  requireStatus(fn.initialize(), 'initialize');
  registerFont();
  registerBinding();
  registerStack();
  registerCodec();

  const text = paragraphTextForGlyphs(glyphs, corpus);
  const utf16 = stringToUtf16(text);
  const limits = { maxClusters: utf16.length + 1, maxLines: utf16.length + 1, maxOutputBytes: outputCapacity };
  const baseGeometry = { width: 600, height: 100_000, maxLines: utf16.length + 1, revision: 1 };
  const baseStyle = { textEnd: utf16.length, fontSize: 24, lineHeight: 1.2, rasterPixelRatio: 1 };

  return {
    createCase(name) {
      if (!rawEngineCases(corpus).includes(name)) throw new RangeError(`unknown raw engine case: ${name}`);
      if (name === 'cold') return createColdCase();
      return createWarmCase(name);
    },
  };

  function createColdCase() {
    const initial = initialBytes('cold');
    return {
      run() {
        createRoot(initial.byteLength);
        const result = execute(initial, true);
        requireStatus(fn.disposeRoot(rootId), 'dispose cold planner');
        assertGlyphTarget(result);
        return result.glyphCount;
      },
      dispose() {},
    };
  }

  function createWarmCase(name) {
    const initial = initialBytes(name);
    createRoot(initial.byteLength);
    let state = execute(initial, true);
    assertGlyphTarget(state);
    const localizedText = [...utf16];
    const spliceStart = Math.floor(utf16.length / 2);
    let spliceInserted = false;
    let suffixDeleted = false;
    let iteration = 0;
    return {
      run() {
        return run(false);
      },
      warmup() {
        return run(true);
      },
      dispose() {
        requireStatus(fn.disposeRoot(rootId), `dispose ${name} planner`);
      },
    };

    function run(allowGrowth) {
      const index = iteration++;
      const common = {
        expectedEngineRevision: state.engineRevision,
        consumedRevision: state.revision,
        acknowledgedPublicationGeneration: state.publicationGeneration,
      };
      let bytes;
      let measureParagraphId;
      if (name === 'publish-measurement' || name === 'publish-inspection') {
        bytes = updateBytes({ ...common, geometry: baseGeometry });
        new DataView(bytes.buffer).setUint32(
          abi.layouts.engineUpdateRequest.semanticViewMask,
          name === 'publish-measurement'
            ? abi.engine.semanticViewMasks.measurement
            : abi.engine.semanticViewMasks.layoutInspection,
          true,
        );
      } else if (name === 'font-size') {
        bytes = updateBytes({
          ...common,
          style: { ...baseStyle, fontSize: 12 + (index % 256) / 128 },
          geometry: baseGeometry,
        });
      } else if (
        name === 'column-resize' ||
        name === 'active-column-resize' ||
        name === 'justify' ||
        name === 'bidi-resize'
      ) {
        const boundedIndex = name === 'column-resize' ? index % 128 : index;
        bytes = updateBytes({
          ...common,
          geometry: rustLayoutBenchmarkGeometry(name, boundedIndex, baseGeometry),
        });
      } else if (
        name === 'measure-query' ||
        name === 'position-query' ||
        name === 'adopt-measure-query' ||
        name === 'adopt-position-query'
      ) {
        bytes = updateBytes({
          ...common,
          geometry: rustLayoutBenchmarkGeometry('active-column-resize', index, baseGeometry),
        });
        const queryBytes = bytes.slice();
        new DataView(queryBytes.buffer).setUint32(
          abi.layouts.engineUpdateRequest.semanticViewMask,
          name === 'position-query' || name === 'adopt-position-query'
            ? abi.engine.semanticViewMasks.borrowedLayout
            : abi.engine.semanticViewMasks.measurement,
          true,
        );
        if (name === 'adopt-measure-query' || name === 'adopt-position-query') {
          execute(queryBytes, allowGrowth, 1);
        } else {
          bytes = queryBytes;
          measureParagraphId = 1;
        }
      } else if (name === 'suffix-edit') {
        const deleteCount = suffixDeleted ? 0 : 1;
        const insert = suffixDeleted ? [utf16.at(-1)] : [];
        suffixDeleted = !suffixDeleted;
        bytes = updateBytes({
          ...common,
          textMutation: { start: utf16.length - 1, deleteCount, insert },
          style: { ...baseStyle, textEnd: utf16.length - Number(suffixDeleted) },
          geometry: baseGeometry,
        });
      } else if (name === 'localized-edit') {
        const start = Math.floor(utf16.length / 2);
        const replacement = localizedText[start] === 0x61 ? 0x62 : 0x61;
        localizedText[start] = replacement;
        bytes = updateBytes({
          ...common,
          textMutation: { start, deleteCount: 1, insert: [replacement] },
          geometry: baseGeometry,
        });
      } else if (name === 'localized-splice') {
        const insert = spliceInserted ? [] : [0x61];
        const deleteCount = spliceInserted ? 1 : 0;
        spliceInserted = !spliceInserted;
        bytes = updateBytes({
          ...common,
          textMutation: { start: spliceStart, deleteCount, insert },
          style: { ...baseStyle, textEnd: utf16.length + Number(spliceInserted) },
          geometry: baseGeometry,
        });
      } else if (name === 'equivalent-width') {
        bytes = updateBytes({ ...common, geometry: rustLayoutBenchmarkGeometry(name, index, baseGeometry) });
      } else {
        bytes = updateBytes({ ...common, geometry: baseGeometry });
      }
      const previous = state;
      state = execute(bytes, allowGrowth, measureParagraphId);
      assertRustLayoutBenchmarkResult(name, previous, state);
      return state.glyphCount + state.patchCount * 1_000_000;
    }
  }

  function initialBytes(name) {
    return updateBytes({
      textMutation: { start: 0, deleteCount: 0, insert: utf16 },
      style: baseStyle,
      geometry: rustLayoutBenchmarkInitialGeometry(name, baseGeometry),
    });
  }

  function createRoot(requestCapacity) {
    requireStatus(fn.createRoot(rootId, requestCapacity, outputCapacity, utf16.length + 1), 'create benchmark planner');
  }

  function execute(bytes, allowGrowth = false, measureParagraphId) {
    const requestPointer = fn.requestPointer(rootId);
    if (requestPointer === 0 || fn.requestCapacity(rootId) < bytes.byteLength) {
      throw new Error('benchmark request exceeds its pre-reserved arena');
    }
    const buffer = memory.buffer;
    new Uint8Array(buffer, requestPointer, bytes.byteLength).set(bytes);
    const resultPointer =
      measureParagraphId === undefined
        ? fn.textUpdate(rootId, requestPointer, bytes.byteLength)
        : fn.measureParagraph(rootId, requestPointer, bytes.byteLength, measureParagraphId);
    if (memory.buffer !== buffer && !allowGrowth) throw new Error('measured engine update grew Wasm memory');
    if (resultPointer === 0) throw new Error('engine update returned a null result');
    const layout = abi.layouts.engineResult;
    const result = new DataView(memory.buffer, resultPointer, layout.size);
    const status = result.getUint32(layout.status, true);
    if (status !== abi.status.ok) throw new Error(`engine update failed with status ${String(status)}`);
    const patchCount = result.getUint32(layout.patchCount, true);
    const patchesOffset = result.getUint32(layout.patchesOffset, true);
    const patchLayout = abi.layouts.enginePatch;
    let writeBytes = 0;
    for (let index = 0; index < patchCount; index += 1) {
      const patch = new DataView(
        memory.buffer,
        resultPointer + patchesOffset + index * patchLayout.size,
        patchLayout.size,
      );
      if (patch.getUint8(patchLayout.opcode) === abi.engine.patchOpcodes.write) {
        writeBytes += patch.getUint32(patchLayout.byteLength, true);
      }
    }
    const primitiveCount = result.getUint32(layout.primitiveCount, true);
    const primitivesOffset = result.getUint32(layout.primitivesOffset, true);
    const primitiveLayout = abi.layouts.enginePrimitive;
    let glyphCount = 0;
    for (let index = 0; index < primitiveCount; index += 1) {
      const primitive = new DataView(
        memory.buffer,
        resultPointer + primitivesOffset + index * primitiveLayout.size,
        primitiveLayout.size,
      );
      if (primitive.getUint8(primitiveLayout.kind) === abi.engine.primitiveKinds.glyph) {
        glyphCount += primitive.getUint16(primitiveLayout.recordCount, true);
      }
    }
    return {
      engineRevision: result.getUint32(layout.engineRevision, true),
      revision: result.getUint32(layout.revision, true),
      publicationGeneration: result.getUint32(layout.publicationGeneration, true),
      glyphCount,
      patchCount,
      writeBytes,
    };
  }

  function updateBytes(fields) {
    return engineFrameUpdateBytes(abi, { rootId, codecHandle, fontStackHandle, limits, ...fields });
  }

  function registerFont() {
    const allocations = [validated.shapingSfnt, validated.glyphExtents, validated.glyphExtentsAvailability].map(
      (bytes) => ({ pointer: copyIntoAllocation(memory, fn.allocate, bytes), length: bytes.byteLength }),
    );
    requireStatus(
      fn.registerFont(
        fontHandle,
        allocations[0].pointer,
        allocations[0].length,
        allocations[1].pointer,
        allocations[1].length,
        allocations[2].pointer,
        allocations[2].length,
      ),
      'register font',
    );
    for (const allocation of allocations) fn.deallocate(allocation.pointer, allocation.length);
  }

  function registerBinding() {
    const bytes = technique.bindingBytes;
    const pointer = copyIntoAllocation(memory, fn.allocate, bytes);
    requireStatus(fn.registerFontBinding(fontHandle, fontHandle, pointer, bytes.byteLength), 'register font binding');
    fn.deallocate(pointer, bytes.byteLength);
  }

  function registerStack() {
    const bytes = Uint8Array.of(fontHandle, 0, 0, 0);
    const pointer = copyIntoAllocation(memory, fn.allocate, bytes);
    requireStatus(fn.registerFontStack(fontStackHandle, pointer, 1), 'register font stack');
    fn.deallocate(pointer, bytes.byteLength);
  }

  function registerCodec() {
    const bytes = technique.codecBytes;
    const pointer = copyIntoAllocation(memory, fn.allocate, bytes);
    requireStatus(fn.registerCodec(codecHandle, pointer, bytes.byteLength), 'register render codec');
    fn.deallocate(pointer, bytes.byteLength);
  }

  function assertGlyphTarget(result) {
    if (result.glyphCount < Math.floor(glyphs * 0.95)) {
      throw new Error(`engine planned only ${String(result.glyphCount)} glyphs for target ${String(glyphs)}`);
    }
  }
}

async function loadArtifact(techniqueName, corpus) {
  const fixtures =
    corpus === 'cjk'
      ? {
          bitmap: ['noto-sans-cjk-showcase-bitmap-16.font.glb', false],
          mtsdf: ['noto-sans-cjk-showcase-mtsdf.font.glb.gz', true],
          slug: ['noto-sans-cjk-showcase-slug.font.glb.gz', true],
        }
      : corpus === 'bidi'
        ? {
            bitmap: ['amiri-bitmap-16.font.glb', false],
            mtsdf: ['amiri-mtsdf.font.glb.gz', true],
            slug: ['amiri-slug.font.glb.gz', true],
          }
        : {
            bitmap: ['inter-bitmap-16.font.glb', false],
            mtsdf: ['inter-mtsdf.font.glb.gz', true],
            slug: ['inter-slug.font.glb.gz', true],
          };
  const entry = fixtures[techniqueName];
  if (entry === undefined) throw new Error(`corpus ${corpus} has no pinned ${techniqueName} artifact`);
  const [file, compressed] = entry;
  const bytes = await readFile(new URL(`../../../../benches/fixtures/rendering/${file}`, import.meta.url));
  return compressed ? gunzipSync(bytes) : bytes;
}

async function validateRaster(techniqueName, bytes, core) {
  const rasterIdentity = core.document.extensions.PMNDRS_font.rasters[0];
  const context = {
    rasterKey: rasterIdentity.rasterKey,
    sourceFingerprint: core.sourceFingerprint,
    shapingFingerprint: core.shapingFingerprint,
    glyphCount: core.glyphCount,
    glyphIdWidth: 16,
  };
  if (techniqueName === 'bitmap') {
    return validateBitmapArtifact(bytes, { ...context, descriptor: bitmapDescriptor({ strikes: [16] }) });
  }
  if (techniqueName === 'mtsdf') {
    return validateMsdfArtifact(bytes, { ...context, descriptor: msdfDescriptor() });
  }
  return validateSlugArtifact(bytes, { ...context, descriptor: slugDescriptor() });
}

function stringToUtf16(value) {
  return Array.from({ length: value.length }, (_, index) => value.charCodeAt(index));
}

function requireStatus(status, operation) {
  if (status !== abi.status.ok) throw new Error(`${operation} failed with status ${String(status)}`);
}
