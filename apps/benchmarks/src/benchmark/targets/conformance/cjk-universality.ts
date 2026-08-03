import {
  createParagraphEngine,
  createRuntimeShaper,
  FontRegistry,
  type Paragraph,
  type ParagraphConstraints,
  type ParagraphLayout,
  type ParagraphStyle,
  type RegisteredFont,
  type RuntimeShaper,
  type ShapeBatchRequest,
} from '@pmndrs/text';
import cjkContract from '../../../../fixtures/contracts/paragraph-cjk-layout-v0.json';
import cjkFontUrl from '../../../../fixtures/fonts/noto-sans-cjk-2.004/NotoSansCJKjp-Regular.otf?url';
import cjkManifest from '../../../../fixtures/fonts/noto-sans-cjk-2.004/manifest.json';
import cjkOracle from '../../../../fixtures/shaping/noto-sans-cjk/harfrust.json';
import type { BenchmarkTarget } from '../../contracts';
import { exactValue } from '../../exact-value';
import { hashParagraphLayouts, paragraphLayoutContract } from '../../paragraph-layout-digest';
import {
  assertShapingFixture,
  hashShapedFixture,
  shapedFixtureBytes,
  shapingFixtureBatch,
  type ShapingOracleCase,
} from '../../shaping-fixture';
import { loadDirectWasmDependencies } from '../shared/direct-wasm';

interface ContractCase {
  readonly text: string;
  readonly style: ParagraphStyle;
  readonly layouts: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

const oracleCases = cjkOracle.cases as readonly ShapingOracleCase[];
const paragraphCases = Object.values(cjkContract.cases) as readonly ContractCase[];
const paragraphConstraints = cjkContract.constraints as Readonly<Record<string, ParagraphConstraints>>;
let state: CjkState | undefined;

interface CjkState {
  readonly font: RegisteredFont;
  readonly shaper: RuntimeShaper;
  readonly paragraphs: readonly Paragraph[];
  readonly shapingRequest: ShapeBatchRequest;
  readonly calls: { shape: number; reshape: number };
  readonly cold: { bakeMs: number; registrationMs: number; shaperInitializationMs: number };
}

export const cjkUniversalityTarget: BenchmarkTarget = {
  id: 'cjk-universality',
  label: 'CJK universality',
  detail: 'Noto Sans CJK · exact shaping + horizontal paragraphs',
  color: 'cyan',
  capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph']),
  status: (input) => (input.fontBytes === undefined ? 'ready' : 'needs-fixture'),
  load: async () => {
    if (state !== undefined) return;
    const { bakerWasmUrl, createFontBaker, shaperWasmUrl } = await loadDirectWasmDependencies();
    const [bakerResponse, shaperResponse, fontResponse] = await Promise.all([
      fetch(bakerWasmUrl),
      fetch(shaperWasmUrl),
      fetch(cjkFontUrl),
    ]);
    for (const [label, response] of [
      ['font baker Wasm', bakerResponse],
      ['text shaper Wasm', shaperResponse],
      ['CJK font fixture', fontResponse],
    ] as const) {
      if (!response.ok) throw new Error(`unable to load ${label} (${response.status})`);
    }
    const [bakerWasm, shaperWasm, source] = await Promise.all([
      bakerResponse.arrayBuffer(),
      shaperResponse.arrayBuffer(),
      fontResponse.arrayBuffer(),
    ]);
    const baker = await createFontBaker(bakerWasm);
    const bakeStart = performance.now();
    const artifact = baker.bake({
      source: new Uint8Array(source),
      descriptor: { formatVersion: 0, fontFaceIndex: 0 },
    }).artifacts[0];
    const bakeMs = performance.now() - bakeStart;
    if (artifact === undefined || artifact.sha256 !== cjkManifest.bake.expectedCore.artifactSha256) {
      throw new Error('CJK bake differs from the authenticated artifact contract');
    }
    const registry = new FontRegistry();
    const registrationStart = performance.now();
    const font = await registry.registerAsset(artifact.bytes);
    const registrationMs = performance.now() - registrationStart;
    if (font.shapingHash !== cjkManifest.bake.expectedCore.shapingHash) {
      throw new Error('CJK registration differs from the authenticated shaping identity');
    }
    const shaperStart = performance.now();
    const runtime = await createRuntimeShaper({ registry, wasm: shaperWasm });
    runtime.registerFont(font);
    const shaperInitializationMs = performance.now() - shaperStart;
    const calls = { shape: 0, reshape: 0 };
    const engine = createParagraphEngine({ shaper: observeShaper(runtime, calls) });
    const paragraphs = paragraphCases.map((fixture) =>
      engine.create({ text: fixture.text, font: font.handle, style: fixture.style }),
    );
    state = {
      font,
      shaper: runtime,
      paragraphs,
      shapingRequest: shapingFixtureBatch(oracleCases, font.handle),
      calls,
      cold: { bakeMs, registrationMs, shaperInitializationMs },
    };
  },
  run: async () => {
    if (state === undefined) throw new Error('CJK universality target was not loaded');
    const shaped = state.shaper.shapeBatch(state.shapingRequest);
    assertShapingFixture(shaped, state.font.handle, oracleCases);
    const layouts: ParagraphLayout[] = [];
    for (const [caseIndex, fixture] of paragraphCases.entries()) {
      const paragraph = state.paragraphs[caseIndex];
      if (paragraph === undefined) throw new Error(`CJK paragraph ${caseIndex} is missing`);
      for (const [constraintId, constraints] of Object.entries(paragraphConstraints)) {
        const layout = paragraph.layout(constraints);
        assertExactContract(
          `${caseIndex}.${constraintId}`,
          paragraphLayoutContract(layout),
          fixture.layouts[constraintId],
        );
        layouts.push(layout);
      }
    }
    const memory = state.shaper.memoryReport();
    return {
      bytes: shapedFixtureBytes(shaped) + layouts.reduce((sum, layout) => sum + layoutBytes(layout), 0),
      hash: `${hashShapedFixture(shaped)}:${hashParagraphLayouts(layouts)}`,
      metrics: {
        sourceUtf16Units:
          oracleCases.reduce((sum, fixture) => sum + fixture.text.length, 0) +
          paragraphCases.reduce((sum, fixture) => sum + fixture.text.length, 0),
        corpusCaseCount: oracleCases.length,
        corpusGlyphCount: shaped.glyphIds.length,
        paragraphCaseCount: paragraphCases.length,
        layoutCount: layouts.length,
        directShapeBoundaryCrossings: 1,
        paragraphShapeBoundaryCrossings: state.calls.shape,
        reshapeBoundaryCrossings: state.calls.reshape,
        planCount: memory.planCount,
        retainedFontBytes: memory.retainedFontBytes,
        wasmMemoryBytes: memory.wasmMemoryBytes,
        sourceFontBytes: cjkManifest.source.fontBytes,
        artifactBytes: cjkManifest.bake.expectedCore.artifactBytes,
        shapingPayloadRawBytes: cjkManifest.bake.expectedCore.transport.shapingPayload.rawBytes,
        shapingPayloadGzipBytes: cjkManifest.bake.expectedCore.transport.shapingPayload.gzipBytes,
        shapingPayloadBrotliBytes: cjkManifest.bake.expectedCore.transport.shapingPayload.brotliBytes,
        coldBakeMs: state.cold.bakeMs,
        coldRegistrationMs: state.cold.registrationMs,
        coldShaperInitializationMs: state.cold.shaperInitializationMs,
      },
    };
  },
  dispose: async () => {
    if (state === undefined) return;
    for (const paragraph of state.paragraphs) paragraph.dispose();
    state.shaper.dispose();
    state.font.dispose();
    state = undefined;
  },
};

function observeShaper(runtime: RuntimeShaper, calls: { shape: number; reshape: number }): RuntimeShaper {
  return {
    registry: runtime.registry,
    registerFont: (font) => runtime.registerFont(font),
    disposeFont: (font) => runtime.disposeFont(font),
    analyzeBidi: (text, direction) => runtime.analyzeBidi(text, direction),
    shapeBatch: (request) => {
      calls.shape += 1;
      return runtime.shapeBatch(request);
    },
    reshapeRanges: (request) => {
      calls.reshape += 1;
      return runtime.reshapeRanges(request);
    },
    memoryReport: () => runtime.memoryReport(),
    dispose: () => runtime.dispose(),
  };
}

function assertExactContract(
  label: string,
  actual: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>> | undefined,
): void {
  if (expected === undefined || !exactValue(actual, expected)) {
    throw new Error(`${label} differs from the exact CJK paragraph contract`);
  }
}

function layoutBytes(layout: ParagraphLayout): number {
  return [
    layout.fontHandles,
    layout.glyphFontSlots,
    layout.glyphIds,
    layout.clusters,
    layout.glyphFontSizes,
    layout.x,
    layout.y,
    layout.glyphFlags,
    layout.lineTextStarts,
    layout.lineTextEnds,
    layout.lineGlyphStarts,
    layout.lineGlyphCounts,
    layout.lineBaselines,
    layout.lineAdvances,
  ].reduce((sum, values) => sum + values.byteLength, 0);
}
