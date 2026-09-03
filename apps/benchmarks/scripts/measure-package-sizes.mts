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
  readonly format: 'javascript' | 'wasm' | 'font-asset';
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
const diagnosticModuleFragments = ['/packages/glyph/dist/internal/raster-baker-profile'];
const diagnosticCodeFragments = [
  'createProfiledDirectRasterBakerFromInstance',
  'profiled MSDF baker',
  // Development-only guidance must not reach a production graph. These fragments come
  // from `if (DEV)` blocks in the package; the production define below folds them away,
  // so seeing one here means a diagnostic escaped its guard and every consumer is paying
  // for it.
  'disposing anyway during',
  'teardown continued after',
  'process.env.NODE_ENV',
];

function isTextPeerDependency(id: string): boolean {
  return (
    id === 'three' ||
    id.startsWith('three/') ||
    id === 'react' ||
    id.startsWith('@react-three/fiber') ||
    // TypeGPU is the optional peer of the `/typegpu` shader subpath. It keys its identity
    // to a single instance exactly as Three and React do, so the consumer-installed
    // runtime stays outside what this package ships and outside its reviewed ceilings.
    // `typed-binary` and `tinyest` are resolution internals reached only through TypeGPU.
    id === 'typegpu' ||
    id.startsWith('typegpu/') ||
    id === 'typed-binary' ||
    id === 'tinyest' ||
    id.startsWith('tinyest')
  );
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
    // Measure what a consumer actually ships. A library build deliberately leaves
    // `process.env.NODE_ENV` for the consuming bundler to replace, so measuring without
    // this define would price development-only diagnostics into every recorded ceiling.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: externalizeWasmAsset
      ? [
          {
            name: 'externalize-package-wasm-for-size-measurement',
            transform(code, id) {
              const wasmAssets = [
                'bitmap-baker.wasm',
                'font-baker.wasm',
                'text-shaper.wasm',
                'mtsdf-baker.wasm',
                'slug-baker.wasm',
              ];
              let transformed = code;
              let changed = false;
              for (const asset of wasmAssets) {
                const expression = new RegExp(
                  `new URL\\((["'\x60])\\.{1,2}\\/(?:\\.{1,2}\\/)*(?:dist\\/)?${asset}\\1,\\s*import\\.meta\\.url\\)`,
                  'g',
                );
                transformed = transformed.replace(expression, (_match, quote: string) => {
                  changed = true;
                  return `new URL(${quote}${asset}${quote}, ${quote}https://size.invalid/${quote})`;
                });
              }
              if (!changed || !id.includes('/packages/glyph/')) return;
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

async function measureAdmittedMsdfGenerator(): Promise<MeasuredEntry> {
  const evidence = JSON.parse(
    await readFile(
      new URL('../../../packages/glyph/rust/mtsdf-admission/evidence/size-v0.json', import.meta.url),
      'utf8',
    ),
  ) as {
    readonly optimizedBytes?: number;
    readonly optimizedSha256?: string;
    readonly gzipBytes?: number;
    readonly brotliBytes?: number;
  };
  if (
    evidence.optimizedBytes === undefined ||
    evidence.optimizedSha256 === undefined ||
    evidence.gzipBytes === undefined ||
    evidence.brotliBytes === undefined
  ) {
    throw new Error('admitted MSDF generator size evidence is incomplete');
  }
  return {
    id: 'mtsdf-generator-wasm',
    label: 'MSDF admitted generator kernel',
    status: 'measured',
    format: 'wasm',
    sha256: evidence.optimizedSha256,
    rawBytes: evidence.optimizedBytes,
    minifiedBytes: evidence.optimizedBytes,
    gzipBytes: evidence.gzipBytes,
    brotliBytes: evidence.brotliBytes,
  };
}

const coreJavaScript = await measureJavaScript(
  'browser-core',
  'Core JS',
  new URL('../size-entries/text-core.ts', import.meta.url),
  false,
  true,
  true,
  {
    expectedDynamic: ['/packages/glyph/dist/runtime-bake', '/packages/glyph/dist/internal/font-face-transfer-runtime'],
    excludedInitial: [
      '/packages/glyph/dist/runtime-bake',
      '/packages/glyph/dist/runtime-bake-worker',
      '/packages/glyph/dist/internal/font-face-transfer-runtime',
      '/packages/glyph/dist/react',
      '/packages/glyph/dist/three',
      '/packages/glyph/dist/raster/bitmap',
      '/packages/glyph/dist/raster/msdf',
      '/packages/glyph/dist/raster/slug',
      '/packages/glyph/dist/bakers/msdf',
      '/packages/glyph/dist/node/',
      '/packages/glyph/dist/font-baker/index',
      '/packages/glyph/dist/font-baker/validator',
      '/packages/glyph/dist/font-baker/wasm-url',
    ],
  },
);
const textShaperWasm = await measureWasm(
  'text-shaper-wasm',
  'Shaper Wasm',
  new URL('../../../packages/glyph/dist/text-shaper.wasm', import.meta.url),
);
const glyphConfig = await measureJavaScript(
  'glyph-config-js',
  'GlyphConfig integration DSL',
  new URL('../size-entries/text-core-subpath.ts', import.meta.url),
  false,
  true,
  true,
  {
    // The renderer-neutral config leaf closure must not pull any renderer integration.
    expectedDynamic: [],
    excludedInitial: [
      '/packages/glyph/dist/react',
      '/packages/glyph/dist/three',
      '/packages/glyph/dist/tsl',
      '/packages/glyph/dist/three/',
      '/packages/glyph/dist/tsl/',
    ],
  },
);
const tslSubpath = await measureJavaScript(
  'tsl-subpath-js',
  'Technique shader library JS',
  new URL('../size-entries/text-tsl.ts', import.meta.url),
  false,
  true,
  true,
  {
    // The shader library must not pull the Three scene integration or React.
    expectedDynamic: [],
    excludedInitial: ['/packages/glyph/dist/react', '/packages/glyph/dist/three'],
  },
);
const typegpuSubpath = await measureJavaScript(
  'typegpu-subpath-js',
  'TypeGPU technique shader JS',
  new URL('../size-entries/text-typegpu.ts', import.meta.url),
  false,
  true,
  true,
  {
    // The TypeGPU shader library must not pull the renderer integrations or React;
    // the `typegpu` runtime itself is an optional peer and stays outside the graph.
    expectedDynamic: [],
    excludedInitial: [
      '/packages/glyph/dist/react',
      '/packages/glyph/dist/three',
      '/packages/glyph/dist/tsl',
      '/packages/glyph/dist/three/',
      '/packages/glyph/dist/tsl/',
    ],
  },
);
const threeRuntime = await measureJavaScript(
  'three-runtime-js',
  'Three.js adapter JS',
  new URL('../size-entries/three-runtime.ts', import.meta.url),
  false,
  true,
  true,
  {
    // Bake owns schema and Khronos validation. Rendering reads only the package extension
    // identity and the byte ranges needed to create safe typed-array views.
    expectedDynamic: ['/packages/glyph/dist/runtime-bake', '/packages/glyph/dist/internal/font-face-transfer-runtime'],
    excludedInitial: [
      '/packages/glyph/dist/runtime-bake',
      '/packages/glyph/dist/internal/font-face-transfer-runtime',
      '/packages/glyph/dist/font-baker/validator',
      '/node_modules/ajv/',
      '/node_modules/gltf-validator/',
    ],
  },
);
const interBitmap = await measureFontAsset(
  'font-inter-bitmap-16-32',
  'Inter font · Bitmap',
  new URL('../fixtures/rendering/inter-bitmap-16-32.font.glb', import.meta.url),
  'identity',
);
const interMsdf = await measureFontAsset(
  'font-inter-mtsdf',
  'Inter font · MTSDF',
  new URL('../fixtures/rendering/inter-mtsdf.font.glb.gz', import.meta.url),
  'gzip',
);
const interSlug = await measureFontAsset(
  'font-inter-slug',
  'Inter font · Slug',
  new URL('../fixtures/rendering/inter-slug.font.glb.gz', import.meta.url),
  'gzip',
);
const iconsBitmap = await measureFontAsset(
  'font-icons-bitmap-16-32',
  'Font Awesome icons · Bitmap',
  new URL('../fixtures/rendering/font-awesome-free-6.7.2-bitmap-16-32.font.glb', import.meta.url),
  'identity',
);
const iconsMsdf = await measureFontAsset(
  'font-icons-mtsdf',
  'Font Awesome icons · MTSDF',
  new URL('../fixtures/rendering/font-awesome-free-6.7.2-mtsdf.font.glb.gz', import.meta.url),
  'gzip',
);
const iconsSlug = await measureFontAsset(
  'font-icons-slug',
  'Font Awesome icons · Slug',
  new URL('../fixtures/rendering/font-awesome-free-6.7.2-slug.font.glb.gz', import.meta.url),
  'gzip',
);

const entries: SizeEntry[] = [
  glyphConfig,
  tslSubpath,
  typegpuSubpath,
  coreJavaScript,
  textShaperWasm,
  threeRuntime,
  interBitmap,
  interMsdf,
  interSlug,
  iconsBitmap,
  iconsMsdf,
  iconsSlug,
  await measureJavaScript(
    'font-validator-js',
    'Font validator JS',
    new URL('../size-entries/font-validator.ts', import.meta.url),
  ),
  await measureJavaScript(
    'runtime-baker-host-js',
    'Runtime bake host JS',
    new URL('../size-entries/runtime-bake.ts', import.meta.url),
  ),
  await measureJavaScript(
    'runtime-baker-worker-js',
    'Runtime bake Worker JS',
    new URL('../../../packages/glyph/dist/runtime-bake-worker.js', import.meta.url),
    false,
    true,
    false,
    {
      expectedDynamic: [
        '/packages/glyph/dist/bakers/bitmap',
        '/packages/glyph/dist/bakers/msdf',
        '/packages/glyph/dist/bakers/slug',
      ],
      excludedInitial: [
        '/packages/glyph/dist/font-baker/validator',
        '/node_modules/ajv/',
        '/node_modules/gltf-validator/',
      ],
    },
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
    'Bitmap baker Wasm',
    new URL('../../../packages/glyph/dist/bitmap-baker.wasm', import.meta.url),
  ),
  await measureJavaScript(
    'bitmap-baker-js',
    'Bitmap baker JS',
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
    'MTSDF baker Wasm',
    new URL('../../../packages/glyph/dist/mtsdf-baker.wasm', import.meta.url),
  ),
  await measureJavaScript(
    'mtsdf-baker-js',
    'MTSDF baker JS',
    new URL('../size-entries/mtsdf-baker.ts', import.meta.url),
    false,
    true,
    false,
    undefined,
    ['performance.now'],
  ),
  await measureWasm(
    'slug-baker-wasm',
    'Slug baker Wasm',
    new URL('../../../packages/glyph/dist/slug-baker.wasm', import.meta.url),
  ),
  await measureJavaScript(
    'slug-baker-js',
    'Slug baker JS',
    new URL('../size-entries/slug-baker.ts', import.meta.url),
    false,
    true,
    false,
    undefined,
    ['performance.now'],
  ),
  await measureJavaScript(
    'portable-baker-js',
    'Font baker JS',
    new URL('../size-entries/font-baker.ts', import.meta.url),
    false,
  ),
  await measureWasm(
    'portable-baker-wasm',
    'Font baker Wasm',
    new URL('../../../packages/glyph/dist/font-baker.wasm', import.meta.url),
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
if (process.argv.includes('--check')) {
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
