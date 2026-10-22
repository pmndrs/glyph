/* @workflow {
  "name": "benchmark:editorial-hero-pixels",
  "summary": "Compare authenticated candidate and independent cold-main paused editorial canvas captures.",
  "requirements": "Two completed installed-archive presentation receipts with PRESENTATION_EDITORIAL_PIXEL_ROLE=candidate and cold-main, plus project Chromium. Pass --candidate and --reference receipt paths, externally pinned --expected-candidate-sha256 and --expected-reference-sha256, and --output for a retained result.",
  "writes": "A comparison JSON receipt at --output when supplied; no repository source."
} */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { launchProjectChromium } from './support/project-chromium.mts';
import { assertDeliveredEntries, sha256 } from './support/archive-dist-proof.mts';
import { assertEditorialCaptureIdentity } from './support/editorial-capture-identity.mts';
import { compareEditorialPngs, inspectEditorialPng } from './support/editorial-pixel-proof.mts';
import { assertEditorialSceneMatchesCapture } from './support/editorial-scene-capture.mts';

interface CaptureReceipt {
  readonly status: 'completed';
  readonly scenario: {
    readonly requestedBackend: string;
    readonly observedBackend: string;
    readonly technique: string;
    readonly shaders: string;
    readonly workload: 'editorial';
    readonly viewport: readonly [number, number];
    readonly dpr: number;
    readonly editorialPixelRole: 'candidate' | 'cold-main';
  };
  readonly archive: {
    readonly archiveSha256: string;
    readonly packageRoot: string;
    readonly installedDistSha256ByPath: Record<string, string>;
    readonly workspaceLockSha256: string;
    readonly sceneSha256: string;
    readonly sceneProofSha256: string;
    readonly runtimeSourceSha256: string;
    readonly captureSourceSha256: string;
    readonly interFixtureSha256: string;
    readonly viewportSourceSha256: string;
  };
  readonly browserVersion: string;
  readonly editorialSceneReceipt: { readonly path: string; readonly sha256: string };
  readonly responses: readonly { readonly source: string; readonly status: number; readonly sha256: string }[];
  readonly editorialPixelCapture: {
    readonly path: string;
    readonly pngSha256: string;
    readonly rgbaSha256: string;
    readonly width: number;
    readonly height: number;
    readonly foregroundPixels: number;
    readonly foregroundBounds: readonly [number, number, number, number];
    readonly hiddenOverlayElements: number;
    readonly state: {
      readonly animationEnabled: false;
      readonly backend: string;
      readonly camera: 'perspective';
      readonly canvasBacking: readonly [number, number];
      readonly canvasCss: readonly [number, number];
      readonly configurationRevision: number;
      readonly dpr: number;
      readonly drawCount: number;
      readonly fontFixture: 'inter';
      readonly frameCount: number;
      readonly glyphCount: number;
      readonly showGrid: true;
      readonly workload: 'editorial';
    };
  };
}

interface EditorialSemanticText {
  readonly role: unknown;
  readonly sourceText: unknown;
  readonly text: unknown;
  readonly style: unknown;
  readonly layout: unknown;
  readonly constraints: unknown;
  readonly flow: unknown;
  readonly rasterPixelRatio: unknown;
  readonly nodeWorldMatrix: unknown;
  readonly textWorldMatrix: unknown;
  readonly aggregateMeasurement: unknown;
  readonly placement: {
    readonly measurement: unknown;
    readonly lines: readonly unknown[];
    readonly glyphs: readonly Record<string, unknown>[];
  };
}

interface EditorialSemanticArtifact {
  readonly queryOrder: 'after-scene-only-png';
  readonly capturedState: unknown;
  readonly producer: {
    readonly schemaVersion: 1;
    readonly configuration: unknown;
    readonly camera: unknown;
    readonly obstacle: unknown;
    readonly texts: readonly EditorialSemanticText[];
  };
}

const candidatePath = option('--candidate');
const referencePath = option('--reference');
const outputPath = option('--output', false);
const expectedCandidateSha256 = digestOption('--expected-candidate-sha256');
const expectedReferenceSha256 = digestOption('--expected-reference-sha256');
const result: Record<string, unknown> = {
  schemaVersion: 1,
  status: 'failed',
  candidateReceipt: candidatePath,
  referenceReceipt: referencePath,
  expectedCandidateSha256,
  expectedReferenceSha256,
  tolerance: { maximumDifferentPixels: 0, basis: 'exact fixed-state comparison; no nonzero tolerance established' },
};
let browser: Awaited<ReturnType<typeof launchProjectChromium>> | undefined;
let failure: unknown;
try {
  const [candidate, reference] = await Promise.all([
    readCapture(candidatePath, 'candidate'),
    readCapture(referencePath, 'cold-main'),
  ]);
  assertEditorialCaptureIdentity(
    candidate.receipt,
    reference.receipt,
    expectedCandidateSha256,
    expectedReferenceSha256,
  );
  assertSameFixture(candidate.receipt, reference.receipt);
  browser = await launchProjectChromium({ headless: true });
  if (
    candidate.receipt.browserVersion !== reference.receipt.browserVersion ||
    browser.version() !== candidate.receipt.browserVersion
  ) {
    throw new Error('Editorial captures and comparator must use the same Chromium version');
  }
  const page = await browser.newPage();
  await page.goto('about:blank');
  const [candidatePixels, referencePixels] = await Promise.all([
    inspectEditorialPng(page, candidate.png),
    inspectEditorialPng(page, reference.png),
  ]);
  for (const [label, actual, receipt] of [
    ['candidate', candidatePixels, candidate.receipt],
    ['cold-main', referencePixels, reference.receipt],
  ] as const) {
    const claimed = receipt.editorialPixelCapture;
    if (
      actual.rgbaSha256 !== claimed.rgbaSha256 ||
      actual.width !== claimed.width ||
      actual.height !== claimed.height ||
      actual.foregroundPixels !== claimed.foregroundPixels ||
      JSON.stringify(actual.foregroundBounds) !== JSON.stringify(claimed.foregroundBounds)
    ) {
      throw new Error(`${label} decoded PNG does not match its capture receipt`);
    }
    if (actual.foregroundPixels < 300 || actual.foregroundBounds === null) {
      throw new Error(`${label} editorial hero is blank or lacks foreground bounds`);
    }
  }
  const diff = await compareEditorialPngs(page, reference.png, candidate.png);
  result.semanticComparison = compareSemanticScenes(candidate.semantic, reference.semantic);
  result.candidate = { archiveSha256: candidate.receipt.archive.archiveSha256, capture: candidatePixels };
  result.reference = { archiveSha256: reference.receipt.archive.archiveSha256, capture: referencePixels };
  result.diff = diff;
  if (diff.differentPixels !== 0) {
    throw new Error(`Editorial hero differs at ${String(diff.differentPixels)} pixels; exact tolerance is zero`);
  }
  result.status = 'completed';
} catch (error) {
  failure = error;
  result.error = String(error);
} finally {
  try {
    await browser?.close();
  } catch (error) {
    result.teardownError = String(error);
    failure ??= error;
    result.status = 'failed';
  }
  if (outputPath !== undefined) {
    try {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    } catch (error) {
      if (failure === undefined) failure = error;
      else process.stderr.write(`Could not persist editorial comparison: ${String(error)}\n`);
    }
  }
  console.log('editorial-hero-pixel-comparison', JSON.stringify(result));
}
if (failure !== undefined) throw failure;

function option(name: '--candidate' | '--reference'): string;
function option(name: '--output', required: false): string | undefined;
function option(name: string, required = true): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    if (required) throw new Error(`${name} requires a path`);
    return undefined;
  }
  return resolve(value);
}

function digestOption(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || !/^[a-f0-9]{64}$/u.test(value)) throw new Error(`${name} requires a SHA-256 hex digest`);
  return value;
}

async function readCapture(
  path: string,
  expectedRole: 'candidate' | 'cold-main',
): Promise<{ receipt: CaptureReceipt; png: Buffer; semantic: EditorialSemanticArtifact }> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (typeof value !== 'object' || value === null) throw new Error(`${expectedRole} receipt is not an object`);
  const receipt = value as Partial<CaptureReceipt>;
  const scenario = receipt.scenario;
  const archive = receipt.archive;
  const capture = receipt.editorialPixelCapture;
  const semanticReceipt = receipt.editorialSceneReceipt;
  if (
    receipt.status !== 'completed' ||
    scenario?.editorialPixelRole !== expectedRole ||
    scenario.workload !== 'editorial' ||
    archive === undefined ||
    capture === undefined ||
    semanticReceipt === undefined ||
    typeof semanticReceipt.path !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(semanticReceipt.sha256 ?? '') ||
    !/^[a-f0-9]{64}$/u.test(archive.archiveSha256 ?? '') ||
    typeof capture.path !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(capture.pngSha256 ?? '') ||
    typeof receipt.browserVersion !== 'string' ||
    !Array.isArray(receipt.responses) ||
    typeof archive.packageRoot !== 'string' ||
    typeof archive.installedDistSha256ByPath !== 'object' ||
    archive.installedDistSha256ByPath === null ||
    typeof archive.workspaceLockSha256 !== 'string' ||
    typeof archive.sceneSha256 !== 'string' ||
    typeof archive.sceneProofSha256 !== 'string' ||
    typeof archive.runtimeSourceSha256 !== 'string' ||
    typeof archive.captureSourceSha256 !== 'string' ||
    typeof archive.interFixtureSha256 !== 'string' ||
    typeof archive.viewportSourceSha256 !== 'string' ||
    typeof capture.rgbaSha256 !== 'string' ||
    typeof capture.width !== 'number' ||
    typeof capture.height !== 'number' ||
    typeof capture.foregroundPixels !== 'number' ||
    !(capture.hiddenOverlayElements > 0) ||
    !Array.isArray(capture.foregroundBounds) ||
    typeof capture.state !== 'object' ||
    capture.state === null
  ) {
    throw new Error(`${expectedRole} receipt is missing completed authenticated editorial capture evidence`);
  }
  const complete = receipt as CaptureReceipt;
  assertDeliveredEntries(complete.responses, [
    'index.js',
    'loader.js',
    'three.js',
    'text-shaper.wasm',
    ...(scenario.shaders === 'typegpu' ? ['three/typegpu.js'] : []),
  ]);
  const deliveredWasm = complete.responses.find(
    (response) => response.source === 'text-shaper.wasm' && response.status === 200,
  );
  if (deliveredWasm?.sha256 !== archive.installedDistSha256ByPath['text-shaper.wasm']) {
    throw new Error(`${expectedRole} delivered shaper does not match the installed archive`);
  }
  const png = await readFile(capture.path);
  if (sha256(png) !== capture.pngSha256) throw new Error(`${expectedRole} PNG differs from its capture receipt`);
  const semanticBytes = await readFile(semanticReceipt.path);
  if (sha256(semanticBytes) !== semanticReceipt.sha256) {
    throw new Error(`${expectedRole} semantic scene differs from its capture receipt`);
  }
  const semantic = parseEditorialSemanticArtifact(semanticBytes.toString('utf8'), expectedRole);
  if (JSON.stringify(semantic.capturedState) !== JSON.stringify(capture.state)) {
    throw new Error(`${expectedRole} semantic scene references a different captured state`);
  }
  assertEditorialSceneMatchesCapture(semantic.producer, capture.state);
  return { receipt: complete, png, semantic };
}

function assertSameFixture(candidate: CaptureReceipt, reference: CaptureReceipt): void {
  const scenario = (receipt: CaptureReceipt) => receipt.scenario;
  const state = (receipt: CaptureReceipt) => receipt.editorialPixelCapture.state;
  const scenarioFields = [
    'requestedBackend',
    'observedBackend',
    'technique',
    'shaders',
    'workload',
    'viewport',
    'dpr',
  ] as const;
  const stateFields = [
    'animationEnabled',
    'backend',
    'camera',
    'canvasBacking',
    'canvasCss',
    'dpr',
    'drawCount',
    'fontFixture',
    'glyphCount',
    'showGrid',
    'workload',
  ] as const;
  for (const field of scenarioFields) {
    if (JSON.stringify(scenario(candidate)[field]) !== JSON.stringify(scenario(reference)[field])) {
      throw new Error(`Editorial scenario mismatch: ${field}`);
    }
  }
  for (const field of stateFields) {
    if (JSON.stringify(state(candidate)[field]) !== JSON.stringify(state(reference)[field])) {
      throw new Error(`Editorial captured state mismatch: ${field}`);
    }
  }
  for (const field of [
    'workspaceLockSha256',
    'sceneSha256',
    'sceneProofSha256',
    'runtimeSourceSha256',
    'captureSourceSha256',
    'interFixtureSha256',
    'viewportSourceSha256',
  ] as const) {
    if (candidate.archive[field] !== reference.archive[field])
      throw new Error(`Editorial source fixture mismatch: ${field}`);
  }
  if (
    candidate.editorialPixelCapture.width !== reference.editorialPixelCapture.width ||
    candidate.editorialPixelCapture.height !== reference.editorialPixelCapture.height
  ) {
    throw new Error('Editorial PNG dimensions differ between capture receipts');
  }
}

function parseEditorialSemanticArtifact(source: string, role: string): EditorialSemanticArtifact {
  const artifact = objectValue(JSON.parse(source), `${role} semantic artifact`);
  const producer = objectValue(artifact.producer, `${role} semantic producer`);
  if (artifact.queryOrder !== 'after-scene-only-png' || producer.schemaVersion !== 1) {
    throw new Error(`${role} semantic scene did not follow the paused pixel capture`);
  }
  if (!Array.isArray(producer.texts) || producer.texts.length !== 2) {
    throw new Error(`${role} semantic scene is missing the lede/body producer texts`);
  }
  const texts = producer.texts.map((value, index) => {
    const text = objectValue(value, `${role} semantic text ${String(index)}`);
    const placement = objectValue(text.placement, `${role} semantic placement ${String(index)}`);
    if (!Array.isArray(placement.lines) || !Array.isArray(placement.glyphs)) {
      throw new Error(`${role} semantic scene has no complete line/glyph rows`);
    }
    return {
      role: text.role,
      sourceText: text.sourceText,
      text: text.text,
      style: text.style,
      layout: text.layout,
      constraints: text.constraints,
      flow: text.flow,
      rasterPixelRatio: text.rasterPixelRatio,
      nodeWorldMatrix: text.nodeWorldMatrix,
      textWorldMatrix: text.textWorldMatrix,
      aggregateMeasurement: text.aggregateMeasurement,
      placement: {
        measurement: placement.measurement,
        lines: placement.lines,
        glyphs: placement.glyphs.map((glyph, glyphIndex) =>
          objectValue(glyph, `${role} glyph ${String(index)}:${String(glyphIndex)}`),
        ),
      },
    };
  });
  return {
    queryOrder: 'after-scene-only-png',
    capturedState: artifact.capturedState,
    producer: {
      schemaVersion: 1,
      configuration: producer.configuration,
      camera: producer.camera,
      obstacle: producer.obstacle,
      texts,
    },
  };
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function compareSemanticScenes(candidate: EditorialSemanticArtifact, reference: EditorialSemanticArtifact) {
  const candidateScene = candidate.producer;
  const referenceScene = reference.producer;
  const different = (left: unknown, right: unknown): boolean => JSON.stringify(left) !== JSON.stringify(right);
  const rowDifferenceCount = (left: readonly unknown[], right: readonly unknown[]): number =>
    Array.from({ length: Math.max(left.length, right.length) }, (_, index) =>
      different(left[index], right[index]) ? 1 : 0,
    ).reduce<number>((sum, changed) => sum + changed, 0);
  const geometry = (glyph: Record<string, unknown>) => {
    const { stableId: _stableId, fontHandle: _fontHandle, fontSlot: _fontSlot, ...placed } = glyph;
    return placed;
  };
  return {
    configurationDiffers: different(candidateScene.configuration, referenceScene.configuration),
    cameraDiffers: different(candidateScene.camera, referenceScene.camera),
    obstacleDiffers: different(candidateScene.obstacle, referenceScene.obstacle),
    texts: candidateScene.texts.map((text, index) => {
      const main = referenceScene.texts[index];
      if (main === undefined) throw new Error('Cold-main semantic scene is missing a text');
      return {
        role: text.role,
        authoredDiffers: different(
          [text.sourceText, text.text, text.style, text.layout, text.constraints, text.rasterPixelRatio],
          [main.sourceText, main.text, main.style, main.layout, main.constraints, main.rasterPixelRatio],
        ),
        flowDiffers: different(text.flow, main.flow),
        worldTransformsDiffer: different(
          [text.nodeWorldMatrix, text.textWorldMatrix],
          [main.nodeWorldMatrix, main.textWorldMatrix],
        ),
        aggregateMeasurementDiffers: different(text.aggregateMeasurement, main.aggregateMeasurement),
        aggregateGlyphCount: {
          candidate: objectValue(text.aggregateMeasurement, 'candidate aggregate measurement').glyphCount,
          coldMain: objectValue(main.aggregateMeasurement, 'cold-main aggregate measurement').glyphCount,
        },
        inspectedMeasurementDiffers: different(text.placement.measurement, main.placement.measurement),
        inspectedGlyphCount: {
          candidate: text.placement.glyphs.length,
          coldMain: main.placement.glyphs.length,
        },
        lineRowsDiffer: rowDifferenceCount(text.placement.lines, main.placement.lines),
        glyphGeometryRowsDiffer: rowDifferenceCount(
          text.placement.glyphs.map(geometry),
          main.placement.glyphs.map(geometry),
        ),
        glyphIdentityRowsDiffer: rowDifferenceCount(text.placement.glyphs, main.placement.glyphs),
      };
    }),
  };
}
