import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { compileTextEngineFrameUpdate } from '../../dist/internal/engine-frame-wire.js';
import { engineFrameUpdateBytes } from '../support/engine-abi.mjs';

const abiUrl = new URL('../../dist/text-shaper-abi-v0.json', import.meta.url);

test('production frame compiler preserves the established benchmark request bytes', async () => {
  const abi = JSON.parse(await readFile(abiUrl, 'utf8'));
  const text = 'A😀B';
  const units = Array.from({ length: text.length }, (_, index) => text.charCodeAt(index));
  const limits = { maxClusters: 8, maxLines: 8, maxOutputBytes: 65_536 };
  const expected = engineFrameUpdateBytes(abi, {
    sessionId: 5,
    policyHandle: 11,
    fontStackHandle: 7,
    textMutation: { start: 0, deleteCount: 0, insert: units },
    style: { textEnd: text.length, fontSize: 24, lineHeight: 1.2, rasterPixelRatio: 2 },
    geometry: { width: 320, height: 180, maxLines: 8, revision: 9 },
    limits,
  });
  const actual = compileTextEngineFrameUpdate({
    sessionId: 5,
    policyHandle: 11,
    capabilitySet: 1,
    expectedEngineRevision: 0,
    consumedPlanRevision: 0,
    acknowledgedPublicationGeneration: 0,
    limits: {
      ...limits,
      maxParagraphs: 1,
      maxRegions: 1,
      maxExclusions: 1,
      maxInlineObjects: 1,
      maxSlotsPerBand: 1,
    },
    paragraphMutations: [{ opcode: 'upsert', paragraphId: 1, order: 0 }],
    textMutations: [{ paragraphId: 1, start: 0, deleteCount: 0, insert: text }],
    styleMutations: [
      {
        opcode: 'upsert',
        paragraphId: 1,
        styleId: 1,
        cascadeOrder: 0,
        start: 0,
        end: text.length,
        root: true,
        value: { fontStackHandle: 7, fontSize: 24, lineHeight: 1.2, rasterPixelRatio: 2 },
      },
    ],
    constraints: [
      {
        paragraphId: 1,
        flowThreadId: 1,
        geometryRevision: 0,
        width: 320,
        height: 180,
        viewportBlockStart: 0,
        viewportBlockEnd: 180,
        resumeBlockOffset: 0,
        maxLines: 8,
        regionStart: 0,
        resumeCluster: 0,
        regionCount: 1,
        resumeRegion: 0,
        widthMode: 'exact',
        heightMode: 'exact',
        wrap: 'word',
        align: 'start',
        overflow: 'visible',
        blockAlign: 'start',
      },
    ],
    regions: [
      {
        id: 1,
        geometryRevision: 9,
        shape: 'rectangle',
        exclusionStart: 0,
        exclusionCount: 0,
        writingMode: 'horizontal-tb',
        textOrientation: 'mixed',
        inlineStart: 0,
        blockStart: 0,
        inlineEnd: 320,
        blockEnd: 180,
        clipInlineStart: 0,
        clipBlockStart: 0,
        clipInlineEnd: 320,
        clipBlockEnd: 180,
      },
    ],
  });
  assert.deepEqual(actual, expected);
});

test('production frame compiler carries full style, polygon, exclusion, and inline-object payloads', async () => {
  const abi = JSON.parse(await readFile(abiUrl, 'utf8'));
  const bytes = compileTextEngineFrameUpdate({
    sessionId: 1,
    policyHandle: 2,
    capabilitySet: 1,
    expectedEngineRevision: 3,
    consumedPlanRevision: 4,
    acknowledgedPublicationGeneration: 5,
    semanticViewMask: 6,
    compositingIndependent: true,
    limits: {
      maxParagraphs: 4,
      maxClusters: 32,
      maxLines: 16,
      maxRegions: 2,
      maxExclusions: 2,
      maxInlineObjects: 2,
      maxSlotsPerBand: 3,
      maxOutputBytes: 1_048_576,
    },
    paragraphMutations: [{ opcode: 'upsert', paragraphId: 3, order: 2 }],
    styleMutations: [
      {
        opcode: 'upsert',
        paragraphId: 3,
        styleId: 9,
        cascadeOrder: 2,
        start: 1,
        end: 5,
        value: {
          fontStackHandle: 7,
          materialId: 8,
          language: 'ja',
          features: [{ tag: 'kern', value: 1, start: 1, end: 5 }],
          fontSize: 18,
          lineHeight: 1.25,
          letterSpacing: 0.5,
          wordSpacing: 1.5,
          baselineShift: -2,
          rasterPixelRatio: 2,
          direction: 'rtl',
          foregroundRgba: 0x1122_3344,
          decoration: {
            style: 'solid',
            rgba: 0x5566_7788,
            underline: true,
            lineThrough: true,
            skipInk: true,
            thickness: 1,
            offset: 2,
          },
        },
      },
    ],
    constraints: [],
    regions: [
      {
        id: 1,
        geometryRevision: 1,
        shape: 'polygon',
        vertices: [
          { inline: 0, block: 0 },
          { inline: 100, block: 0 },
          { inline: 100, block: 100 },
        ],
        exclusionStart: 0,
        exclusionCount: 1,
        writingMode: 'vertical-rl',
        textOrientation: 'upright',
        inlineStart: 0,
        blockStart: 0,
        inlineEnd: 100,
        blockEnd: 100,
        clipInlineStart: 0,
        clipBlockStart: 0,
        clipInlineEnd: 100,
        clipBlockEnd: 100,
      },
    ],
    exclusions: [
      {
        id: 2,
        regionId: 1,
        geometryRevision: 1,
        shape: 'polygon',
        vertices: [
          { inline: 20, block: 20 },
          { inline: 40, block: 20 },
          { inline: 30, block: 40 },
        ],
        wrapSide: 'largest',
        inlineStart: 20,
        blockStart: 20,
        inlineEnd: 40,
        blockEnd: 40,
        marginInline: 2,
        marginBlock: 3,
      },
    ],
    inlineObjects: [
      {
        paragraphId: 3,
        id: 3,
        contentRevision: 1,
        textOffset: 4,
        materialId: 8,
        resourceId: 10,
        resourceGeneration: 1,
        inlineExtent: 12,
        blockExtent: 14,
        baselineOffset: 2,
        marginInlineStart: 1,
        marginInlineEnd: 1,
        marginBlockStart: 0,
        marginBlockEnd: 0,
        baselineAlignment: 'alphabetic',
      },
    ],
    policyParameters: Uint8Array.of(7, 8, 9),
  });
  const request = abi.layouts.engineUpdateRequest;
  const header = new DataView(bytes.buffer, bytes.byteOffset, request.size);
  assert.equal(header.getUint32(request.flags, true), abi.engine.frameFlags.compositingIndependent);
  assert.equal(header.getUint32(request.byteLength, true), bytes.byteLength);
  assert.equal(header.getUint32(request.styleMutationCount, true), 1);
  assert.equal(header.getUint32(request.regionCount, true), 1);
  assert.equal(header.getUint32(request.exclusionCount, true), 1);
  assert.equal(header.getUint32(request.inlineObjectCount, true), 1);
  assert.equal(header.getUint32(request.policyParametersLength, true), 3);
  assert.deepEqual(bytes.slice(header.getUint32(request.policyParametersOffset, true)), Uint8Array.of(7, 8, 9));
  const styleOffset = header.getUint32(request.styleMutationsOffset, true);
  const style = abi.layouts.engineStyleMutation;
  const styleView = new DataView(bytes.buffer, bytes.byteOffset + styleOffset, style.size);
  assert.equal(styleView.getUint32(style.paragraphId, true), 3);
  assert.equal(styleView.getUint8(style.direction), 2);
  assert.equal(styleView.getUint16(style.languageLength, true), 2);
  assert.equal(styleView.getUint16(style.featureCount, true), 1);
  assert.equal(styleView.getUint32(style.materialId, true), 8);
  assert.equal(styleView.getUint32(style.decorationFlags, true), 13);
  const inlineObjectOffset = header.getUint32(request.inlineObjectsOffset, true);
  const inlineObject = abi.layouts.engineInlineObject;
  const inlineObjectView = new DataView(bytes.buffer, bytes.byteOffset + inlineObjectOffset, inlineObject.size);
  assert.equal(inlineObjectView.getUint32(inlineObject.paragraphId, true), 3);
});
