import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

import { assertPackageSizeReportFresh, type PackageSizeReport } from '../src/benchmark/package-size-report.ts';

interface MeasuredEntry {
  readonly id: string;
  readonly label: string;
  readonly status: 'measured';
  readonly format: 'javascript' | 'wasm';
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
): Promise<MeasuredEntry> {
  const [raw, minified] = await Promise.all([
    bundle(fileURLToPath(entry), false, includeDynamic, externalizeWasmAsset, externalizePeerDependencies),
    bundle(fileURLToPath(entry), 'oxc', includeDynamic, externalizeWasmAsset, externalizePeerDependencies),
  ]);
  if (graphBoundary !== undefined) {
    assertGraphBoundary(label, raw, graphBoundary.expectedDynamic, graphBoundary.excludedInitial);
    assertGraphBoundary(label, minified, graphBoundary.expectedDynamic, graphBoundary.excludedInitial);
  }
  return {
    id,
    label,
    status: 'measured',
    format: 'javascript',
    rawBytes: raw.bytes.byteLength,
    minifiedBytes: minified.bytes.byteLength,
    ...compression(minified.bytes),
  };
}

async function measureWasm(id: string, label: string, source: URL): Promise<MeasuredEntry> {
  const bytes = await readFile(source);
  return {
    id,
    label,
    status: 'measured',
    format: 'wasm',
    rawBytes: bytes.byteLength,
    minifiedBytes: bytes.byteLength,
    ...compression(bytes),
  };
}

async function measureAdmittedMtsdfGenerator(): Promise<MeasuredEntry> {
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
    scalar.gzipBytes === undefined ||
    scalar.brotliBytes === undefined
  ) {
    throw new Error('admitted scalar MTSDF generator size evidence is incomplete');
  }
  return {
    id: 'mtsdf-generator-wasm',
    label: 'MTSDF admitted generator kernel',
    status: 'measured',
    format: 'wasm',
    rawBytes: scalar.optimizedBytes,
    minifiedBytes: scalar.optimizedBytes,
    gzipBytes: scalar.gzipBytes,
    brotliBytes: scalar.brotliBytes,
  };
}

const entries: SizeEntry[] = [
  await measureJavaScript(
    'browser-core',
    'Browser core',
    new URL('../size-entries/text-core.ts', import.meta.url),
    false,
    true,
    true,
    {
      expectedDynamic: ['/packages/text/dist/runtime-bake.js'],
      excludedInitial: [
        '/packages/text/dist/runtime-bake.js',
        '/packages/text/dist/runtime-bake-worker.js',
        '/packages/text/dist/react.js',
        '/packages/text/dist/raster/bitmap.js',
        '/packages/text/dist/raster/msdf.js',
        '/packages/text/dist/raster/slug.js',
        '/packages/text/dist/bakers/msdf.js',
        '/packages/text/dist/node/',
        '/packages/font-baker/dist/index.js',
        '/packages/font-baker/dist/wasm.js',
        '/packages/font-baker/dist/validator.js',
      ],
    },
  ),
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
    'text-shaper-js',
    'Text shaper JS',
    new URL('../size-entries/text-shaper.ts', import.meta.url),
    false,
    true,
  ),
  await measureWasm(
    'text-shaper-wasm',
    'Text shaper Wasm',
    new URL('../../../packages/text/dist/text_shaper.wasm', import.meta.url),
  ),
  await measureJavaScript(
    'bitmap-runtime-js',
    'Bitmap runtime JS graph',
    new URL('../size-entries/bitmap-runtime.ts', import.meta.url),
    false,
    true,
    true,
    {
      expectedDynamic: [],
      excludedInitial: [
        '/packages/text/dist/raster/slug.js',
        '/packages/text/dist/internal/slug-shaders/',
        '/packages/text/dist/bakers/slug.js',
        '/packages/text/dist/runtime-bakers/slug',
      ],
    },
  ),
  await measureJavaScript(
    'mtsdf-runtime-js',
    'MTSDF runtime JS graph',
    new URL('../size-entries/mtsdf-runtime.ts', import.meta.url),
    false,
    true,
    true,
    {
      expectedDynamic: [],
      excludedInitial: [
        '/packages/text/dist/raster/slug.js',
        '/packages/text/dist/internal/slug-shaders/',
        '/packages/text/dist/bakers/slug.js',
        '/packages/text/dist/runtime-bakers/slug',
      ],
    },
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
  ),
  await measureJavaScript(
    'mtsdf-generator-js',
    'MTSDF generator host JS',
    new URL('../size-entries/mtsdf-generator.ts', import.meta.url),
  ),
  await measureAdmittedMtsdfGenerator(),
  await measureWasm(
    'mtsdf-baker-wasm',
    'MTSDF fixed baker Wasm',
    new URL('../../../packages/text/dist/mtsdf_baker.wasm', import.meta.url),
  ),
  await measureJavaScript(
    'mtsdf-baker-js',
    'MTSDF fixed baker host JS',
    new URL('../size-entries/mtsdf-baker.ts', import.meta.url),
    false,
    true,
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
  schemaVersion: 0,
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
}
process.stdout.write(serialized);
