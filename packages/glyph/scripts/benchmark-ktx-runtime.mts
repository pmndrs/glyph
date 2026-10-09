/* @workflow { "name": "glyph:ktx-runtime-performance", "summary": "Compare the current bounded KTX2 validator with the production ktx-parse policy it replaces.", "requirements": "Built @pmndrs/glyph, ktx-parse development dependency, authenticated Inter Bitmap/MTSDF/Slug LFS fixtures, and Darwin or Linux advisory-lock tooling. The workflow serializes timing through /private/tmp/glyph-perf-measurement.lock.", "writes": "A temporary ignored .cache/ktx-runtime-performance fixture pack, removed on exit; JSON evidence to stdout." } */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { PerformanceObserver, performance } from 'node:perf_hooks';

interface NativeFormat {
  readonly name: string;
  readonly vkFormat: number;
  readonly typeSize: number;
  readonly blockWidth: number;
  readonly blockHeight: number;
  readonly bytesPerBlock: number;
  readonly uncompressedChannelTypes?: readonly number[];
  readonly float16ChannelTypes?: readonly number[];
}

interface FixtureRecord {
  readonly id: string;
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly format: NativeFormat;
  readonly source: 'authenticated-lfs' | 'derived-compressed';
  readonly suites: readonly ('six-format' | 'representative-pages')[];
}

interface FixtureManifest {
  readonly artifacts: readonly {
    readonly file: string;
    readonly compressedSha256: string;
    readonly uncompressedSha256: string;
  }[];
  readonly fixtures: readonly FixtureRecord[];
}

interface LoadedFixture extends FixtureRecord {
  readonly bytes: Uint8Array;
}

interface TimingSummary {
  readonly samples: number;
  readonly median: number;
  readonly p25: number;
  readonly p75: number;
}

type Implementation = 'ktx-parse' | 'native';
type Validator = (bytes: Uint8Array, width: number, height: number, format: NativeFormat) => Uint8Array;

const BASELINE_COMMIT = 'f97d17be528c5fe0dbcf88ee407c000f46a38825';
const COLD_SAMPLES = 15;
const WARM_SAMPLES = 25;
const WARM_VALIDATIONS_PER_FIXTURE = 2_000;
const ALLOCATION_VALIDATIONS = 120_000;
const ALLOCATION_SAMPLING_INTERVAL = 512;
const GLB_MAGIC = 0x4654_6c67;
const GLB_JSON_CHUNK = 0x4e4f_534a;
const GLB_BIN_CHUNK = 0x004e_4942;
const CHANNELS = [0, 1, 2, 15] as const;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const cache = join(packageRoot, '.cache/ktx-runtime-performance');
const manifestPath = join(cache, 'manifest.json');
const performanceLockPath = '/private/tmp/glyph-perf-measurement.lock';
const workerIndex = process.argv.indexOf('--worker');
const performanceLockHeld = process.argv.includes('--performance-lock-held');

async function runBenchmark(): Promise<void> {
  await rm(cache, { recursive: true, force: true });
  await mkdir(cache, { recursive: true });
  try {
    const manifest = await prepareFixtures();
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const coldBaseline: number[] = [];
    const coldNative: number[] = [];
    for (let index = 0; index < COLD_SAMPLES; index += 1) {
      const order: readonly Implementation[] = index % 2 === 0 ? ['ktx-parse', 'native'] : ['native', 'ktx-parse'];
      for (const implementation of order) {
        const sample = runChild<{ readonly milliseconds: number }>('cold', implementation);
        (implementation === 'ktx-parse' ? coldBaseline : coldNative).push(sample.milliseconds);
      }
    }

    const warm = runChild<{
      readonly checksums: Readonly<Record<string, string>>;
      readonly sixFormat: Readonly<Record<Implementation, TimingSummary>>;
      readonly representativePages: Readonly<Record<Implementation, TimingSummary>>;
    }>('warm');
    const allocation: Readonly<Record<Implementation, AllocationEvidence>> = {
      'ktx-parse': runChild<AllocationEvidence>('allocation', 'ktx-parse'),
      native: runChild<AllocationEvidence>('allocation', 'native'),
    };

    const cold = {
      'ktx-parse': summarize(coldBaseline),
      native: summarize(coldNative),
    } as const;
    const evidence = {
      schemaVersion: 1,
      environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        cpu: cpus()[0]?.model ?? 'unknown',
      },
      comparison: {
        baseline: `ktx-parse 1.1.0 with Glyph policy from ${BASELINE_COMMIT}`,
        candidate: 'bounded package-owned native KTX2 reader',
      },
      fixtures: {
        artifacts: manifest.artifacts,
        sixFormat: manifest.fixtures
          .filter((fixture) => fixture.suites.includes('six-format'))
          .map(({ id, format, source }) => ({ id, format: format.name, source })),
        representativePageCount: manifest.fixtures.filter((fixture) => fixture.suites.includes('representative-pages'))
          .length,
        preparedBeforeTiming: true,
        note: 'R8, RGBA8, and RGBA16F pages are exact authenticated LFS payloads; BC4, EAC R11, and ASTC containers are independently serialized before timing from authenticated R8 payload bytes because no compressed KTX fixture is checked in.',
      },
      correctness: {
        sameInputs: true,
        samePayloadChecksums: true,
        zeroCopyOutputs: true,
        checksums: warm.checksums,
      },
      coldModuleLoadAndValidation: {
        unit: 'milliseconds',
        fixture: 'authenticated Inter R8 page',
        processLaunchExcluded: true,
        fixtureConstructionAndIoExcluded: true,
        'ktx-parse': cold['ktx-parse'],
        native: cold.native,
        speedup: cold['ktx-parse'].median / cold.native.median,
      },
      warmValidation: {
        unit: 'nanoseconds per validation',
        samples: WARM_SAMPLES,
        validationsPerFixturePerSample: WARM_VALIDATIONS_PER_FIXTURE,
        sixFormat: comparison(warm.sixFormat),
        representativePages: comparison(warm.representativePages),
      },
      allocationAndGc: {
        validations: ALLOCATION_VALIDATIONS,
        allocationMetric: `V8 statistical heap-allocation sampling at ${ALLOCATION_SAMPLING_INTERVAL}-byte intervals`,
        gcMetric: 'automatic Node GC events observed during the allocation phase; explicit pre-run GC excluded',
        ...allocation,
        sampledAllocationReduction:
          1 - allocation.native.sampledBytesPerValidation / allocation['ktx-parse'].sampledBytesPerValidation,
      },
      limitations: [
        'This measures JavaScript KTX parsing and Glyph policy validation, not texture upload, GPU rendering, or frame rate.',
        'Cold samples use a fresh process for each implementation, include module loading and one validation, and exclude process startup, fixture construction, fixture I/O, GLB parsing, and gzip.',
        'Allocation bytes are statistical V8 samples rather than an exact language-level allocation counter; GC counts are workload observations, not a latency guarantee.',
      ],
    };
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
}

interface AllocationEvidence {
  readonly sampledBytes: number;
  readonly sampledBytesPerValidation: number;
  readonly gcEvents: number;
  readonly gcMilliseconds: number;
}

function runChild<Result>(mode: string, implementation?: Implementation): Result {
  const result = spawnSync(
    process.execPath,
    ['--expose-gc', scriptPath, '--worker', mode, ...(implementation === undefined ? [] : [implementation])],
    { cwd: packageRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`KTX benchmark ${mode}/${String(implementation)} failed:\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as Result;
}

async function runWorker(mode: string | undefined, implementation: Implementation | undefined): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as FixtureManifest;
  const fixtures = await Promise.all(
    manifest.fixtures.map(
      async (fixture): Promise<LoadedFixture> => ({
        ...fixture,
        bytes: await readFile(join(cache, fixture.file)),
      }),
    ),
  );
  if (mode === 'cold' && implementation !== undefined) {
    const fixture = fixtures.find((candidate) => candidate.id === 'inter-r8-page-0');
    if (fixture === undefined) throw new Error('Missing cold-path fixture');
    const started = performance.now();
    const validate = await loadValidator(implementation);
    const payload = validate(fixture.bytes, fixture.width, fixture.height, fixture.format);
    const milliseconds = performance.now() - started;
    assertZeroCopy(fixture.bytes, payload, fixture.id);
    process.stdout.write(`${JSON.stringify({ milliseconds })}\n`);
    return;
  }
  if (mode === 'warm') {
    const validators = {
      'ktx-parse': await loadValidator('ktx-parse'),
      native: await loadValidator('native'),
    } as const;
    const checksums = verifyEquivalent(fixtures, validators);
    const sixFormat = fixtures.filter((fixture) => fixture.suites.includes('six-format'));
    const representativePages = fixtures.filter((fixture) => fixture.suites.includes('representative-pages'));
    const result = {
      checksums,
      sixFormat: measureWarmSuite(sixFormat, validators),
      representativePages: measureWarmSuite(representativePages, validators),
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode === 'allocation' && implementation !== undefined) {
    const validator = await loadValidator(implementation);
    const sixFormat = fixtures.filter((fixture) => fixture.suites.includes('six-format'));
    const result = await measureAllocations(sixFormat, validator);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error(`Unknown KTX benchmark worker mode: ${String(mode)}`);
}

async function loadValidator(implementation: Implementation): Promise<Validator> {
  if (implementation === 'ktx-parse') {
    const baseline = await import('./support/ktx-parse-baseline.mjs');
    return baseline.validateKtxParseBaseline;
  }
  const candidate = await import('../dist/internal/raster-ktx.js');
  return candidate.validateNativeKtx2;
}

function verifyEquivalent(
  fixtures: readonly LoadedFixture[],
  validators: Readonly<Record<Implementation, Validator>>,
): Readonly<Record<string, string>> {
  const checksums: Record<string, string> = {};
  for (const fixture of fixtures) {
    const baseline = validators['ktx-parse'](fixture.bytes, fixture.width, fixture.height, fixture.format);
    const native = validators.native(fixture.bytes, fixture.width, fixture.height, fixture.format);
    assertZeroCopy(fixture.bytes, baseline, `${fixture.id} ktx-parse`);
    assertZeroCopy(fixture.bytes, native, `${fixture.id} native`);
    const baselineChecksum = sha256(baseline);
    const nativeChecksum = sha256(native);
    if (baselineChecksum !== nativeChecksum || baseline.byteOffset !== native.byteOffset) {
      throw new Error(`${fixture.id} implementations returned different payload views`);
    }
    checksums[fixture.id] = nativeChecksum;
  }
  return checksums;
}

function assertZeroCopy(input: Uint8Array, output: Uint8Array, label: string): void {
  if (output.buffer !== input.buffer) throw new Error(`${label} copied its payload`);
}

function measureWarmSuite(
  fixtures: readonly LoadedFixture[],
  validators: Readonly<Record<Implementation, Validator>>,
): Readonly<Record<Implementation, TimingSummary>> {
  for (let index = 0; index < 5_000; index += 1) {
    const fixture = fixtures[index % fixtures.length]!;
    validators['ktx-parse'](fixture.bytes, fixture.width, fixture.height, fixture.format);
    validators.native(fixture.bytes, fixture.width, fixture.height, fixture.format);
  }
  const samples: Record<Implementation, number[]> = { 'ktx-parse': [], native: [] };
  for (let sample = 0; sample < WARM_SAMPLES; sample += 1) {
    const order: readonly Implementation[] = sample % 2 === 0 ? ['ktx-parse', 'native'] : ['native', 'ktx-parse'];
    for (const implementation of order) {
      const validate = validators[implementation];
      let observedBytes = 0;
      const started = performance.now();
      for (let iteration = 0; iteration < WARM_VALIDATIONS_PER_FIXTURE; iteration += 1) {
        for (const fixture of fixtures) {
          observedBytes ^= validate(fixture.bytes, fixture.width, fixture.height, fixture.format).byteLength;
        }
      }
      const elapsed = performance.now() - started;
      if (!Number.isSafeInteger(observedBytes)) throw new Error('Invalid benchmark observation');
      samples[implementation].push((elapsed * 1_000_000) / (WARM_VALIDATIONS_PER_FIXTURE * fixtures.length));
    }
  }
  return { 'ktx-parse': summarize(samples['ktx-parse']), native: summarize(samples.native) };
}

async function measureAllocations(
  fixtures: readonly LoadedFixture[],
  validate: Validator,
): Promise<AllocationEvidence> {
  const exposedGc = (globalThis as { gc?: () => void }).gc;
  exposedGc?.();
  await new Promise<void>((resolve) => setImmediate(resolve));

  let gcEvents = 0;
  let gcMilliseconds = 0;
  const recordGc = (entries: readonly PerformanceEntry[]): void => {
    for (const entry of entries) {
      gcEvents += 1;
      gcMilliseconds += entry.duration;
    }
  };
  const observer = new PerformanceObserver((entries) => {
    recordGc(entries.getEntries());
  });
  observer.observe({ entryTypes: ['gc'] });

  const session = new Session();
  session.connect();
  await inspectorPost(session, 'HeapProfiler.enable');
  await inspectorPost(session, 'HeapProfiler.startSampling', {
    samplingInterval: ALLOCATION_SAMPLING_INTERVAL,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  let observedBytes = 0;
  for (let index = 0; index < ALLOCATION_VALIDATIONS; index += 1) {
    const fixture = fixtures[index % fixtures.length]!;
    observedBytes ^= validate(fixture.bytes, fixture.width, fixture.height, fixture.format).byteLength;
  }
  if (!Number.isSafeInteger(observedBytes)) throw new Error('Invalid benchmark observation');
  await new Promise<void>((resolve) => setImmediate(resolve));
  recordGc(observer.takeRecords());
  const sampling = (await inspectorPost(session, 'HeapProfiler.stopSampling')) as {
    readonly profile: HeapProfile;
  };
  session.disconnect();
  observer.disconnect();
  const sampledBytes = heapProfileBytes(sampling.profile.head);
  return {
    sampledBytes,
    sampledBytesPerValidation: sampledBytes / ALLOCATION_VALIDATIONS,
    gcEvents,
    gcMilliseconds,
  };
}

interface HeapProfileNode {
  readonly selfSize: number;
  readonly children: readonly HeapProfileNode[];
}

interface HeapProfile {
  readonly head: HeapProfileNode;
}

function heapProfileBytes(node: HeapProfileNode): number {
  return node.selfSize + node.children.reduce((total, child) => total + heapProfileBytes(child), 0);
}

function inspectorPost(session: Session, method: string, parameters?: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    session.post(method, parameters, (error, result) => (error === null ? resolve(result) : reject(error)));
  });
}

function comparison(values: Readonly<Record<Implementation, TimingSummary>>): object {
  return {
    'ktx-parse': values['ktx-parse'],
    native: values.native,
    speedup: values['ktx-parse'].median / values.native.median,
  };
}

function summarize(values: readonly number[]): TimingSummary {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    median: percentile(sorted, 0.5),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

async function prepareFixtures(): Promise<FixtureManifest> {
  const sourceSpecs = [
    {
      file: 'inter-bitmap-16.font.glb',
      compressedSha256: 'acdca408ed169c7aa1c2791dbbc2982afa1939c56fbc59ef43cc38f7ff366c14',
      uncompressedSha256: 'acdca408ed169c7aa1c2791dbbc2982afa1939c56fbc59ef43cc38f7ff366c14',
      extension: 'PMNDRS_font_bitmap',
      format: FORMATS.r8,
    },
    {
      file: 'inter-mtsdf.font.glb.gz',
      compressedSha256: '2dd8582a3b342bc33b2630184516520d3f944cd146f19ca994fcf66e1e63c472',
      uncompressedSha256: '68598c9b26badc103cf889d4d7ef2f7328d30ba267933db1a73105e9b83f56e8',
      extension: 'PMNDRS_font_distance_field',
      format: FORMATS.rgba8,
    },
    {
      file: 'inter-slug.font.glb.gz',
      compressedSha256: '1f6b3f51c1e9a1c598e43c83e4430cafd437a1e3642c3d97a7c1d6e2fcc7f5ee',
      uncompressedSha256: 'b9326ba7c5c79e30e9823bb39990dd77155f49bc93c634229f18d94be9745e12',
      extension: 'PMNDRS_font_slug',
      format: FORMATS.rgba16f,
    },
  ] as const;
  const fixtures: FixtureRecord[] = [];
  const authenticatedPages: LoadedFixture[] = [];
  for (const spec of sourceSpecs) {
    const compressed = await readFile(join(workspace, 'benches/fixtures/rendering', spec.file));
    if (sha256(compressed) !== spec.compressedSha256) throw new Error(`${spec.file} compressed SHA-256 mismatch`);
    const glb = spec.file.endsWith('.gz') ? gunzipSync(compressed) : compressed;
    if (sha256(glb) !== spec.uncompressedSha256) throw new Error(`${spec.file} uncompressed SHA-256 mismatch`);
    const pages = extractKtxPages(glb, spec.extension, spec.format);
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index]!;
      const id = `inter-${spec.format.name.toLowerCase()}-page-${String(index)}`;
      const file = `${id}.ktx2`;
      await writeFile(join(cache, file), page.bytes);
      const fixture: FixtureRecord = {
        id,
        file,
        width: page.width,
        height: page.height,
        format: spec.format,
        source: 'authenticated-lfs',
        suites: ['representative-pages', ...(index === 0 ? (['six-format'] as const) : [])],
      };
      fixtures.push(fixture);
      authenticatedPages.push({ ...fixture, bytes: page.bytes });
    }
  }

  const r8 = authenticatedPages.find((fixture) => fixture.format.name === 'R8');
  if (r8 === undefined) throw new Error('Missing authenticated R8 page');
  const { read, write, createDefaultContainer, ...ktx } = await import('ktx-parse');
  const sourcePayload = read(r8.bytes).levels[0]!.levelData;
  for (const format of [FORMATS.bc4, FORMATS.eac, FORMATS.astc]) {
    const levelByteLength =
      Math.ceil(r8.width / format.blockWidth) * Math.ceil(r8.height / format.blockHeight) * format.bytesPerBlock;
    const levelData = new Uint8Array(levelByteLength);
    for (let index = 0; index < levelData.byteLength; index += 1) {
      levelData[index] = sourcePayload[index % sourcePayload.byteLength]!;
    }
    const container = createDefaultContainer();
    Object.assign(container, {
      vkFormat: format.vkFormat,
      typeSize: format.typeSize,
      pixelWidth: r8.width,
      pixelHeight: r8.height,
      levelCount: 1,
      levels: [{ levelData, uncompressedByteLength: levelData.byteLength }],
      dataFormatDescriptor: [
        {
          vendorId: ktx.KHR_DF_VENDORID_KHRONOS,
          descriptorType: ktx.KHR_DF_KHR_DESCRIPTORTYPE_BASICFORMAT,
          versionNumber: ktx.KHR_DF_VERSION,
          colorModel: ktx.KHR_DF_MODEL_RGBSDA,
          colorPrimaries: ktx.KHR_DF_PRIMARIES_BT709,
          transferFunction: ktx.KHR_DF_TRANSFER_LINEAR,
          flags: 0,
          texelBlockDimension: [format.blockWidth - 1, format.blockHeight - 1, 0, 0],
          bytesPlane: [format.bytesPerBlock, 0, 0, 0, 0, 0, 0, 0],
          samples: [],
        },
      ],
      keyValue: {},
    });
    const bytes = write(container, { keepWriter: true });
    const id = `derived-${format.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
    const file = `${id}.ktx2`;
    await writeFile(join(cache, file), bytes);
    fixtures.push({
      id,
      file,
      width: r8.width,
      height: r8.height,
      format,
      source: 'derived-compressed',
      suites: ['six-format'],
    });
  }
  return {
    artifacts: sourceSpecs.map(({ file, compressedSha256, uncompressedSha256 }) => ({
      file,
      compressedSha256,
      uncompressedSha256,
    })),
    fixtures,
  };
}

const FORMATS = {
  r8: {
    name: 'R8',
    vkFormat: 9,
    typeSize: 1,
    blockWidth: 1,
    blockHeight: 1,
    bytesPerBlock: 1,
    uncompressedChannelTypes: [CHANNELS[0]],
  },
  rgba8: {
    name: 'RGBA8',
    vkFormat: 37,
    typeSize: 1,
    blockWidth: 1,
    blockHeight: 1,
    bytesPerBlock: 4,
    uncompressedChannelTypes: CHANNELS,
  },
  rgba16f: {
    name: 'RGBA16F',
    vkFormat: 97,
    typeSize: 2,
    blockWidth: 1,
    blockHeight: 1,
    bytesPerBlock: 8,
    float16ChannelTypes: CHANNELS,
  },
  bc4: { name: 'BC4', vkFormat: 139, typeSize: 1, blockWidth: 4, blockHeight: 4, bytesPerBlock: 8 },
  eac: { name: 'EAC R11', vkFormat: 153, typeSize: 1, blockWidth: 4, blockHeight: 4, bytesPerBlock: 8 },
  astc: { name: 'ASTC 4×4', vkFormat: 157, typeSize: 1, blockWidth: 4, blockHeight: 4, bytesPerBlock: 16 },
} as const satisfies Readonly<Record<string, NativeFormat>>;

function extractKtxPages(
  bytes: Uint8Array,
  extensionName: string,
  format: NativeFormat,
): readonly { readonly bytes: Uint8Array; readonly width: number; readonly height: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 28 || view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) {
    throw new Error('Authenticated font fixture is not GLB 2.0');
  }
  if (view.getUint32(8, true) !== bytes.byteLength || view.getUint32(16, true) !== GLB_JSON_CHUNK) {
    throw new Error('Authenticated font fixture has an invalid GLB envelope');
  }
  const jsonByteLength = view.getUint32(12, true);
  const binHeaderOffset = 20 + jsonByteLength;
  if (binHeaderOffset + 8 > bytes.byteLength || view.getUint32(binHeaderOffset + 4, true) !== GLB_BIN_CHUNK) {
    throw new Error('Authenticated font fixture has no BIN chunk');
  }
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, binHeaderOffset)).trimEnd()) as unknown;
  const document = record(json, 'GLB document');
  const extension = record(record(document.extensions, 'GLB extensions')[extensionName], extensionName);
  const pages =
    extensionName === 'PMNDRS_font_bitmap'
      ? array(record(array(extension.strikes, 'bitmap strikes')[0], 'bitmap strike').pages, 'bitmap pages')
      : extensionName === 'PMNDRS_font_slug'
        ? array(extension.pages, 'slug pages').map((page) => record(page, 'slug page').curve)
        : array(extension.pages, 'distance-field pages');
  const bufferViews = array(document.bufferViews, 'GLB bufferViews');
  const binByteOffset = binHeaderOffset + 8;
  return pages.map((pageValue, index) => {
    const page = record(pageValue, `${extensionName} page ${String(index)}`);
    const variants = array(page.variants, `${extensionName} page variants`);
    const variant = record(variants[0], `${extensionName} page variant`);
    if (variant.container !== 'ktx2') throw new Error(`${extensionName} page is not KTX2`);
    const source = record(variant.source, `${extensionName} page source`);
    const bufferViewIndex = integer(source.bufferView, `${extensionName} page bufferView`);
    const bufferView = record(bufferViews[bufferViewIndex], `${extensionName} page bufferView`);
    const byteOffset = optionalInteger(bufferView.byteOffset, `${extensionName} page byteOffset`) ?? 0;
    const byteLength = integer(bufferView.byteLength, `${extensionName} page byteLength`);
    if (byteOffset > bytes.byteLength - binByteOffset || byteLength > bytes.byteLength - binByteOffset - byteOffset) {
      throw new Error(`${extensionName} page lies outside the GLB BIN chunk`);
    }
    return {
      bytes: bytes.subarray(binByteOffset + byteOffset, binByteOffset + byteOffset + byteLength),
      width: integer(page.width, `${extensionName} page width`),
      height: integer(page.height, `${extensionName} page height`),
      format,
    };
  });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} is not an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} is not a nonnegative integer`);
  return value as number;
}

function optionalInteger(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : integer(value, label);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function runWithPerformanceLock(): void {
  const command = process.platform === 'darwin' ? '/usr/bin/lockf' : process.platform === 'linux' ? 'flock' : undefined;
  if (command === undefined) throw new Error('KTX runtime timing requires lockf on Darwin or flock on Linux');
  const commandArguments =
    process.platform === 'darwin'
      ? ['-t', '0', performanceLockPath, process.execPath, scriptPath, '--performance-lock-held']
      : [
          '--nonblock',
          '--conflict-exit-code',
          '75',
          performanceLockPath,
          process.execPath,
          scriptPath,
          '--performance-lock-held',
        ];
  const result = spawnSync(command, commandArguments, { cwd: packageRoot, stdio: 'inherit' });
  if (result.error !== undefined) throw result.error;
  if (result.status === 75) throw new Error(`KTX runtime timing could not acquire ${performanceLockPath}`);
  if (result.status !== 0) throw new Error(`KTX runtime timing failed under ${performanceLockPath}`);
}

if (workerIndex >= 0) {
  const mode = process.argv[workerIndex + 1];
  const implementation = process.argv[workerIndex + 2] as Implementation | undefined;
  await runWorker(mode, implementation);
} else if (!performanceLockHeld) {
  runWithPerformanceLock();
} else {
  await runBenchmark();
}
