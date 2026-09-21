import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assert, bench, group } from '@pmndrs/labs';

const packageRoot = process.env.GLYPH_LABS_PACKAGE_ROOT;
if (packageRoot === undefined) {
  throw new Error('GLYPH_LABS_PACKAGE_ROOT must identify an installed @pmndrs/glyph package');
}

interface PlannerFrame {
  readonly [key: string]: unknown;
}

interface PreparedFrame {
  readonly byteLength: number;
}

interface FrameWireModule {
  compilePlannerFrameUpdate(frame: PlannerFrame): Uint8Array;
  preparePlannerFrameUpdate?(frame: PlannerFrame): PreparedFrame;
  writePreparedPlannerFrameUpdate?(prepared: PreparedFrame, target: Uint8Array): void;
}

const frameWire = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/internal/frame-wire.js')).href
)) as FrameWireModule;

const limits = {
  maxParagraphs: 1_000,
  maxClusters: 32_000,
  maxLines: 8_000,
  maxRegions: 1_000,
  maxExclusions: 1_000,
  maxInlineObjects: 1_000,
  maxSlotsPerBand: 8,
  maxOutputBytes: 16 * 1024 * 1024,
};
const paragraphIds = Array.from({ length: 1_000 }, (_, index) => index + 10);

const orderFrame: PlannerFrame = {
  rootId: 1,
  codecHandle: 2,
  expectedEngineRevision: 1,
  consumedRevision: 1,
  acknowledgedPublicationGeneration: 1,
  limits,
  paragraphOrderMutations: paragraphIds.map((paragraphId, orderRank) => ({
    paragraphId,
    orderScope: 0,
    orderRank,
  })),
};

const semanticFrame: PlannerFrame = {
  rootId: 1,
  codecHandle: 2,
  expectedEngineRevision: 1,
  consumedRevision: 1,
  acknowledgedPublicationGeneration: 1,
  limits,
  paragraphMutations: paragraphIds.map((paragraphId, order) => ({ opcode: 'upsert', paragraphId, order })),
  textMutations: paragraphIds.map((paragraphId, index) => ({
    paragraphId,
    start: 0,
    deleteCount: 0,
    insert: `request arena label ${String(index).padStart(4, '0')}`,
  })),
};

const singleSemanticFrame: PlannerFrame = {
  rootId: 1,
  codecHandle: 2,
  expectedEngineRevision: 1,
  consumedRevision: 1,
  acknowledgedPublicationGeneration: 1,
  limits: { ...limits, maxParagraphs: 1 },
  paragraphMutations: [{ opcode: 'upsert', paragraphId: paragraphIds[0]!, order: 0 }],
  textMutations: [
    {
      paragraphId: paragraphIds[0]!,
      start: 0,
      deleteCount: 0,
      insert: 'request arena label 0000',
    },
  ],
};

function sample(bytes: Uint8Array): number {
  return bytes.byteLength + bytes[0]! + bytes[Math.floor(bytes.byteLength / 2)]! + bytes[bytes.byteLength - 1]!;
}

function benchmarkFrame(name: string, frame: PlannerFrame): void {
  bench(name, function* () {
    const expected = frameWire.compilePlannerFrameUpdate(frame);
    const target = new Uint8Array(expected.byteLength);
    const expectedSample = sample(expected);

    const result = yield () => {
      if (
        frameWire.preparePlannerFrameUpdate === undefined ||
        frameWire.writePreparedPlannerFrameUpdate === undefined
      ) {
        target.set(frameWire.compilePlannerFrameUpdate(frame));
      } else {
        const prepared = frameWire.preparePlannerFrameUpdate(frame);
        frameWire.writePreparedPlannerFrameUpdate(prepared, target);
      }
      return sample(target);
    };

    assert.equal(result, expectedSample);
  });
}

group('direct request-arena encoding @engine', () => {
  benchmarkFrame('write one paragraph and text mutation @semantic', singleSemanticFrame);
  benchmarkFrame('write 1000 paragraph-order mutations @order', orderFrame);
  benchmarkFrame('write 1000 paragraph and text mutations @semantic', semanticFrame);
});
