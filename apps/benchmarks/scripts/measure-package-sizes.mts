import { createHash } from 'node:crypto';
import { brotliCompressSync, constants, gunzipSync, gzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

import { assertPackageSizeReportFresh, type PackageSizeReport } from '../src/benchmark/package-size-report.ts';

interface MeasuredEntry {
  readonly id: string;
  readonly label: string;
  readonly status: 'measured';
  readonly format: 'javascript' | 'wasm' | 'font-asset' | 'aggregate';
  readonly sha256: string;
  readonly rawBytes: number;
  readonly minifiedBytes: number;
  readonly gzipBytes: number;
  readonly brotliBytes: number;
}

interface UnavailableEntry {
  readonly id: string;
  readonly label: string;
  readonly status: 'unavailable';
  readonly reason: string;
}

type SizeEntry = MeasuredEntry | UnavailableEntry;

interface BundleResult {
  readonly bytes: Uint8Array;
  readonly includedModules: ReadonlySet<string>;
  readonly excludedDynamicModules: ReadonlySet<string>;
}

const root = fileURLToPath(new URL('..', import.meta.url));
const diagnosticModuleFragments = ['/packages/text/dist/internal/raster-baker-profile.js'];
const diagnosticCodeFragments = ['createProfiledDirectRasterBakerFromInstance', 'profiled MSDF baker'];

function isTextPeerDependency(id: string): boolean {
  return id === 'three' || id.startsWith('three/') || id === 'react' || id.startsWith('@react-three/fiber');
}

async function bundle(
  entry: string,
  minify: false | 'oxc',
  includeDynamic: boolean,
  externalizeWasmAsset: boolean,
  externalizePeerDependencies: boolean,
): Promise<BundleResult> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: externalizeWasmAsset
      ? [
          {
            name: 'externalize-package-wasm-for-size-measurement',
            transform(code, id) {
              const wasmAssets = [
                'bitmap_baker.wasm',
                'font_baker.wasm',
                'text_shaper.wasm',
                'mtsdf_baker.wasm',
                'slug_baker.wasm',
              ];
              let transformed = code;
              let changed = false;
              for (const asset of wasmAssets) {
                for (const relative of ['./', '../']) {
                  for (const quote of ['"', "'"]) {
                    const expression = `new URL(${quote}${relative}${asset}${quote}, import.meta.url)`;
                    if (!transformed.includes(expression)) continue;
                    transformed = transformed.replaceAll(
                      expression,
                      `new URL(${quote}${asset}${quote}, ${quote}https://size.invalid/${quote})`,
                    );
                    changed = true;
                  }
                }
              }
              if (!changed || (!id.includes('/packages/text/') && !id.includes('/packages/font-baker/'))) return;
              return transformed;
            },
          },
        ]
      : [],
    root,
    build: {
      lib: {
        entry,
        formats: ['es'],
        fileName: 'entry',
      },
      minify,
      target: 'es2022',
      write: false,
      rollupOptions: {
        preserveEntrySignatures: 'strict',
        ...(externalizePeerDependencies
          ? {
              external: isTextPeerDependency,
            }
          : {}),
      },
    },
  });
  const builds = Array.isArray(result) ? result : [result];
  const chunks = builds.flatMap((output) => {
    if (!('output' in output)) throw new Error('Package-size build unexpectedly entered watch mode');
    return output.output.filter((artifact) => artifact.type === 'chunk');
  });
  const included = new Set<string>();
  const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const visit = (fileName: string): void => {
    if (included.has(fileName)) return;
    const chunk = byFileName.get(fileName);
    if (chunk === undefined && externalizePeerDependencies && isTextPeerDependency(fileName)) return;
    if (chunk === undefined) throw new Error(`Package-size build omitted static chunk ${fileName}`);
    included.add(fileName);
    for (const imported of chunk.imports) visit(imported);
  };
  if (includeDynamic) {
    for (const chunk of chunks) included.add(chunk.fileName);
  } else {
    for (const chunk of chunks) if (chunk.isEntry) visit(chunk.fileName);
  }
  const bundledCode = chunks.filter(({ fileName }) => included.has(fileName)).map(({ code }) => code);
  if (bundledCode.length === 0) throw new Error(`Package-size entry emitted no JavaScript: ${entry}`);
  const includedModules = new Set(
    chunks.filter(({ fileName }) => included.has(fileName)).flatMap(({ moduleIds }) => moduleIds),
  );
  const excludedDynamicModules = new Set(
    chunks
      .filter(({ fileName }) => !included.has(fileName) && chunkIsDynamicallyReachable(fileName, chunks))
      .flatMap(({ moduleIds }) => moduleIds),
  );
  return {
    bytes: new TextEncoder().encode(bundledCode.join('\n')),
    includedModules,
    excludedDynamicModules,
  };
}

function chunkIsDynamicallyReachable(
  fileName: string,
  chunks: ReadonlyArray<{ readonly dynamicImports: readonly string[] }>,
): boolean {
  return chunks.some(({ dynamicImports }) => dynamicImports.includes(fileName));
}

function assertGraphBoundary(
  label: string,
  graph: BundleResult,
  expectedDynamic: readonly string[],
  excludedInitial: readonly string[],
): void {
  const normalize = (modules: ReadonlySet<string>): string => [...modules].join('\n');
  const dynamic = normalize(graph.excludedDynamicModules);
  for (const fragment of expectedDynamic) {
    if (!dynamic.includes(fragment)) throw new Error(`${label} did not retain ${fragment} behind a dynamic import`);
  }
  for (const fragment of excludedInitial) {
    const matches = [...graph.includedModules].filter((module) => module.includes(fragment));
    if (matches.length > 0)
      throw new Error(`${label} pulled ${fragment} into its initial bundle graph:\n${matches.join('\n')}`);
  }
}

function assertThinJavaScriptGraph(label: string, graph: BundleResult, excludedCode: readonly string[]): void {
  for (const fragment of diagnosticModuleFragments) {
    const matches = [...graph.includedModules].filter((module) => module.includes(fragment));
    if (matches.length > 0) {
      throw new Error(
        `${label} pulled diagnostic-only module ${fragment} into its shipped graph:\n${matches.join('\n')}`,
      );
    }
  }
  const code = new TextDecoder().decode(graph.bytes);
  for (const fragment of [...diagnosticCodeFragments, ...excludedCode]) {
    if (code.includes(fragment)) throw new Error(`${label} contains excluded diagnostic code ${fragment}`);
  }
}

function compression(bytes: Uint8Array): Pick<MeasuredEntry, 'gzipBytes' | 'brotliBytes'> {
  return {
    gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(bytes, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
      },
    }).byteLength,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function measureJavaScript(
  id: string,
  label: string,
  entry: URL,
  includeDynamic = true,
  externalizeWasmAsset = false,
  externalizePeerDependencies = false,
  graphBoundary?: {
    readonly expectedDynamic: readonly string[];
    readonly excludedInitial: readonly string[];
  },
  excludedCode: readonly string[] = [],
): Promise<MeasuredEntry> {
  const [raw, minified] = await Promise.all([
    bundle(fileURLToPath(entry), false, includeDynamic, externalizeWasmAsset, externalizePeerDependencies),
    bundle(fileURLToPath(entry), 'oxc', includeDynamic, externalizeWasmAsset, externalizePeerDependencies),
  ]);
  if (graphBoundary !== undefined) {
    assertGraphBoundary(label, raw, graphBoundary.expectedDynamic, graphBoundary.excludedInitial);
    assertGraphBoundary(label, minified, graphBoundary.expectedDynamic, graphBoundary.excludedInitial);
  }
  assertThinJavaScriptGraph(label, raw, excludedCode);
  assertThinJavaScriptGraph(label, minified, excludedCode);
  return {
    id,
    label,
    status: 'measured',
    format: 'javascript',
    sha256: sha256(minified.bytes),
    rawBytes: raw.bytes.byteLength,
    minifiedBytes: minified.bytes.byteLength,
    ...compression(minified.bytes),
  };
}

async function measureWasm(id: string, label: string, source: URL): Promise<MeasuredEntry> {
  const bytes = await readFile(source);
  const module = new WebAssembly.Module(bytes);
  const boundaryNames = [...WebAssembly.Module.imports(module), ...WebAssembly.Module.exports(module)].map(
    ({ name }) => name,
  );
  const diagnosticName = boundaryNames.find((name) => /profil|timing|clock|instant/i.test(name));
  if (diagnosticName !== undefined) {
    throw new Error(`${label} exposes diagnostic-only Wasm boundary ${diagnosticName}`);
  }
  return {
    id,
    label,
    status: 'measured',
    format: 'wasm',
    sha256: sha256(bytes),
    rawBytes: bytes.byteLength,
    minifiedBytes: bytes.byteLength,
    ...compression(bytes),
  };
}

async function measureFontAsset(
  id: string,
  label: string,
  source: URL,
  transport: 'identity' | 'gzip',
): Promise<MeasuredEntry> {
  const transferred = await readFile(source);
  const payload = transport === 'gzip' ? gunzipSync(transferred) : transferred;
  return {
    id,
    label,
    status: 'measured',
    format: 'font-asset',
    sha256: sha256(transferred),
    rawBytes: payload.byteLength,
    minifiedBytes: payload.byteLength,
    gzipBytes: transport === 'gzip' ? transferred.byteLength : gzipSync(payload, { level: 9 }).byteLength,
    brotliBytes: compression(payload).brotliBytes,
  };
}

function aggregateSize(id: string, label: string, parts: readonly MeasuredEntry[]): MeasuredEntry {
  const identity = new TextEncoder().encode(parts.map((part) => `${part.id}:${part.sha256}`).join('\n'));
  return {
    id,
    label,
    status: 'measured',
    format: 'aggregate',
    sha256: sha256(identity),
    rawBytes: parts.reduce((total, part) => total + part.rawBytes, 0),
    minifiedBytes: parts.reduce((total, part) => total + part.minifiedBytes, 0),
    gzipBytes: parts.reduce((total, part) => total + part.gzipBytes, 0),
    brotliBytes: parts.reduce((total, part) => total + part.brotliBytes, 0),
  };
}

async function measureAdmittedMsdfGenerator(): Promise<MeasuredEntry> {
  const evidence = JSON.parse(
    await readFile(
      new URL('../../../packages/text/rust/mtsdf-admission/evidence/simd-v0.json', import.meta.url),
      'utf8',
    ),
  ) as {
    readonly decision?: { readonly selected?: string };
    readonly variants?: Readonly<
      Record<
        string,
        {
          readonly optimizedBytes?: number;
          readonly optimizedSha256?: string;
          readonly gzipBytes?: number;
          readonly brotliBytes?: number;
        }
      >
    >;
  };
  const scalar = evidence.variants?.scalar;
  if (
    evidence.decision?.selected !== 'scalar' ||
    scalar?.optimizedBytes === undefined ||
    scalar.optimizedSha256 === undefined ||
    scalar.gzipBytes === undefined ||
    scalar.brotliBytes === undefined
  ) {
    throw new Error('admitted scalar MSDF generator size evidence is incomplete');
  }
  return {
    id: 'mtsdf-generator-wasm',
    label: 'MSDF admitted generator kernel',
    status: 'measured',
    format: 'wasm',
    sha256: scalar.optimizedSha256,
    rawBytes: scalar.optimizedBytes,
    minifiedBytes: scalar.optimizedBytes,
    gzipBytes: scalar.gzipBytes,
    brotliBytes: scalar.brotliBytes,
  };
}

const browserCore = await measureJavaScript(
  'browser-core',
  'Renderer-neutral core JS (peers and Wasm external)',
  new URL('../size-entries/text-core.ts', import.meta.url),
  false,
  true,
  true,
  {
    expectedDynamic: ['/packages/text/dist/runtime-bake.js'],
    excludedInitial: [
      '/packages/text/dist/runtime-bake.js',
      '/packages/text/dist/runtime-bake-worker.js',
      '/packages/text/dist/r3f.js',
      '/packages/text/dist/three.js',
      '/packages/text/dist/raster/bitmap-technique.js',
      '/packages/text/dist/raster/msdf.js',
      '/packages/text/dist/raster/slug-technique.js',
      '/packages/text/dist/bakers/msdf.js',
      '/packages/text/dist/node/',
      '/packages/font-baker/dist/index.js',
      '/packages/font-baker/dist/wasm.js',
      '/packages/font-baker/dist/validator.js',
    ],
  },
);
const textShaperWasm = await measureWasm(
  'text-shaper-wasm',
  'Text engine Wasm',
  new URL('../../../packages/text/dist/text_shaper.wasm', import.meta.url),
);
const threeRuntime = await measureJavaScript(
  'three-runtime-js',
  'Complete Three adapter JS (peers and Wasm external)',
  new URL('../size-entries/three-runtime.ts', import.meta.url),
  false,
  true,
  true,
);
const interBitmap = await measureFontAsset(
  'font-inter-bitmap-16-32',
  'Inter 4.1 Bitmap font asset (16 + 32 ppem)',
  new URL('../fixtures/rendering/inter-bitmap-16-32.font.glb', import.meta.url),
  'identity',
);
const interMsdf = await measureFontAsset(
  'font-inter-mtsdf',
  'Inter 4.1 MTSDF font asset',
  new URL('../fixtures/rendering/inter-mtsdf.font.glb.gz', import.meta.url),
  'gzip',
);
const interSlug = await measureFontAsset(
  'font-inter-slug',
  'Inter 4.1 Slug font asset',
  new URL('../fixtures/rendering/inter-slug.font.glb.gz', import.meta.url),
  'gzip',
);
const iconsBitmap = await measureFontAsset(
  'font-icons-bitmap-16-32',
  'Font Awesome Free 6.7.2 Bitmap icon asset (16 + 32 ppem)',
  new URL('../fixtures/rendering/font-awesome-free-6.7.2-bitmap-16-32.font.glb', import.meta.url),
  'identity',
);
const iconsMsdf = await measureFontAsset(
  'font-icons-mtsdf',
  'Font Awesome Free 6.7.2 MTSDF icon asset',
  new URL('../fixtures/rendering/font-awesome-free-6.7.2-mtsdf.font.glb.gz', import.meta.url),
  'gzip',
);
const iconsSlug = await measureFontAsset(
  'font-icons-slug',
  'Font Awesome Free 6.7.2 Slug icon asset',
  new URL('../fixtures/rendering/font-awesome-free-6.7.2-slug.font.glb.gz', import.meta.url),
  'gzip',
);

const entries: SizeEntry[] = [
  browserCore,
  textShaperWasm,
  aggregateSize('renderer-neutral-core-total', 'Renderer-neutral core total (JS + Wasm)', [
    browserCore,
    textShaperWasm,
  ]),
  threeRuntime,
  aggregateSize('three-renderer-total', 'Complete Three text renderer total (adapter JS + Wasm; peers external)', [
    threeRuntime,
    textShaperWasm,
  ]),
  interBitmap,
  interMsdf,
  interSlug,
  iconsBitmap,
  iconsMsdf,
  iconsSlug,
  aggregateSize('delivery-three-inter-bitmap', 'Three + engine + Inter Bitmap delivery total', [
    threeRuntime,
    textShaperWasm,
    interBitmap,
  ]),
  aggregateSize('delivery-three-inter-mtsdf', 'Three + engine + Inter MTSDF delivery total', [
    threeRuntime,
    textShaperWasm,
    interMsdf,
  ]),
  aggregateSize('delivery-three-inter-slug', 'Three + engine + Inter Slug delivery total', [
    threeRuntime,
    textShaperWasm,
    interSlug,
  ]),
  aggregateSize('delivery-three-icons-bitmap', 'Three + engine + Font Awesome Bitmap delivery total', [
    threeRuntime,
    textShaperWasm,
    iconsBitmap,
  ]),
  aggregateSize('delivery-three-icons-mtsdf', 'Three + engine + Font Awesome MTSDF delivery total', [
    threeRuntime,
    textShaperWasm,
    iconsMsdf,
  ]),
  aggregateSize('delivery-three-icons-slug', 'Three + engine + Font Awesome Slug delivery total', [
    threeRuntime,
    textShaperWasm,
    iconsSlug,
  ]),
  await measureJavaScript(
    'font-validator-js',
    'Lazy font validator JS',
    new URL('../size-entries/font-validator.ts', import.meta.url),
  ),
  await measureJavaScript(
    'runtime-baker-host-js',
    'Runtime baker host JS',
    new URL('../size-entries/runtime-bake.ts', import.meta.url),
  ),
  await measureJavaScript(
    'runtime-baker-worker-js',
    'Runtime baker Worker JS',
    new URL('../../../packages/text/dist/runtime-bake-worker.js', import.meta.url),
    true,
    true,
  ),
  await measureJavaScript(
    'bitmap-runtime-js',
    'Bitmap runtime JS graph',
    new URL('../size-entries/bitmap-runtime.ts', import.meta.url),
    false,
    true,
    true,
  ),
  await measureJavaScript(
    'mtsdf-runtime-js',
    'MSDF runtime JS graph',
    new URL('../size-entries/mtsdf-runtime.ts', import.meta.url),
    false,
    true,
    true,
  ),
  await measureJavaScript(
    'slug-runtime-js',
    'Slug runtime JS graph',
    new URL('../size-entries/slug-runtime.ts', import.meta.url),
    false,
    true,
    true,
  ),
  await measureWasm(
    'bitmap-baker-wasm',
    'Bitmap fixed baker Wasm',
    new URL('../../../packages/text/dist/bitmap_baker.wasm', import.meta.url),
  ),
  await measureJavaScript(
    'bitmap-baker-js',
    'Bitmap fixed baker host JS',
    new URL('../size-entries/bitmap-baker.ts', import.meta.url),
    false,
    true,
    false,
    undefined,
    ['performance.now'],
  ),
  await measureJavaScript(
    'mtsdf-generator-js',
    'MSDF generator host JS',
    new URL('../size-entries/mtsdf-generator.ts', import.meta.url),
  ),
  await measureAdmittedMsdfGenerator(),
  await measureWasm(
    'mtsdf-baker-wasm',
    'MSDF fixed baker Wasm',
    new URL('../../../packages/text/dist/mtsdf_baker.wasm', import.meta.url),
  ),
  await measureJavaScript(
    'mtsdf-baker-js',
    'MSDF fixed baker host JS',
    new URL('../size-entries/mtsdf-baker.ts', import.meta.url),
    false,
    true,
    false,
    undefined,
    ['performance.now'],
  ),
  await measureWasm(
    'slug-baker-wasm',
    'Slug fixed baker Wasm',
    new URL('../../../packages/text/dist/slug_baker.wasm', import.meta.url),
  ),
  await measureJavaScript(
    'slug-baker-js',
    'Slug fixed baker host JS',
    new URL('../size-entries/slug-baker.ts', import.meta.url),
    false,
    true,
    false,
    undefined,
    ['performance.now'],
  ),
  await measureJavaScript(
    'portable-baker-js',
    'Portable baker JS',
    new URL('../size-entries/font-baker.ts', import.meta.url),
  ),
  await measureWasm(
    'portable-baker-wasm',
    'Portable baker Wasm',
    new URL('../../../packages/font-baker/dist/font_baker.wasm', import.meta.url),
  ),
  await measureJavaScript(
    'unicode-analysis-js',
    'Unicode 17 analysis JS',
    new URL('../size-entries/unicode-analysis.ts', import.meta.url),
  ),
];

const report = {
  schemaVersion: 1,
  measurementHost: {
    platform: process.platform,
    architecture: process.arch,
  },
  entries,
};
const output = new URL('../src/generated/package-sizes.json', import.meta.url);
const serialized = `${JSON.stringify(report, null, 2)}\n`;
const sizeLimitJson = process.argv.includes('--size-limit-json');
if (sizeLimitJson) {
  const committed = await readFile(output, 'utf8');
  assertPackageSizeReportFresh(JSON.parse(committed) as PackageSizeReport, report);
  const results = entries.flatMap((entry) => {
    if (entry.status !== 'measured') return [];
    switch (entry.format) {
      case 'javascript':
        return [{ name: `${entry.id} (brotli)`, size: entry.brotliBytes }];
      case 'wasm':
      case 'font-asset':
        return [
          { name: `${entry.id} (raw)`, size: entry.rawBytes },
          { name: `${entry.id} (gzip)`, size: entry.gzipBytes },
          { name: `${entry.id} (brotli)`, size: entry.brotliBytes },
        ];
      case 'aggregate':
        return [
          { name: `${entry.id} (gzip)`, size: entry.gzipBytes },
          { name: `${entry.id} (brotli)`, size: entry.brotliBytes },
        ];
    }
  });
  process.stdout.write(JSON.stringify(results));
} else if (process.argv.includes('--check')) {
  const committed = await readFile(output, 'utf8');
  assertPackageSizeReportFresh(JSON.parse(committed) as PackageSizeReport, report);
} else {
  await mkdir(new URL('../src/generated/', import.meta.url), { recursive: true });
  await writeFile(output, serialized);
  process.stdout.write(serialized);
}
/* @workflow
{
  "name": "release:size:generate",
  "summary": "Regenerate reviewed package-size evidence.",
  "requirements": "Built runtime packages and Binaryen.",
  "writes": "Checked-in package-size evidence."
}
*/
/* @workflow
{
  "name": "release:size:check",
  "summary": "Verify package-size identity and reviewed ceilings.",
  "requirements": "Built runtime packages and Binaryen.",
  "writes": "Nothing.",
  "args": ["--check"]
}
*/
