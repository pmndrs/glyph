import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Alias, Plugin, build as viteBuild } from 'vite';

export interface JavaScriptBundle {
  readonly bytes: Uint8Array;
  readonly includedModules: ReadonlySet<string>;
  readonly excludedDynamicModules: ReadonlySet<string>;
}

export interface JavaScriptBundleVariants {
  readonly raw: JavaScriptBundle;
  readonly minified: JavaScriptBundle;
}

interface BundleOptions {
  readonly aliases?: readonly Alias[];
  readonly entry: string;
  readonly external?: (id: string) => boolean;
  readonly includeDynamic: boolean;
  readonly label: string;
  readonly plugins?: readonly Plugin[];
  readonly workspace: string;
}

const bundleTimeoutMs = 3 * 60 * 1_000;

/** Generates raw and Oxc-minified outputs from one tree-shaken module graph. */
export async function bundleJavaScriptVariants({
  aliases = [],
  entry,
  external,
  includeDynamic,
  label,
  plugins = [],
  workspace,
}: BundleOptions): Promise<JavaScriptBundleVariants> {
  const vitePath = createRequire(join(workspace, 'benches/package.json')).resolve('vite');
  const { build } = (await import(pathToFileURL(vitePath).href)) as { readonly build: typeof viteBuild };
  const result = await withinBundleDeadline(
    label,
    build({
      configFile: false,
      logLevel: 'silent',
      root: workspace,
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      resolve: { alias: [...aliases] },
      plugins: [...plugins],
      build: {
        lib: { entry, formats: ['es'], fileName: 'entry' },
        // Rolldown generates both outputs from the same module graph. Per-output minification
        // avoids the previous second resolve/load/transform/tree-shake traversal.
        minify: 'oxc',
        target: 'es2022',
        write: false,
        rolldownOptions: {
          preserveEntrySignatures: 'strict',
          ...(external === undefined ? {} : { external }),
          output: [
            {
              entryFileNames: 'raw/[name].js',
              chunkFileNames: 'raw/[name]-[hash].js',
              minify: 'dce-only',
              comments: true,
            },
            {
              entryFileNames: 'minified/[name].js',
              chunkFileNames: 'minified/[name]-[hash].js',
              minify: { compress: true, mangle: true, codegen: false },
              comments: { annotation: true, jsdoc: false, legal: false },
            },
          ],
        },
      },
    }),
  );
  const outputs = Array.isArray(result) ? result : [result];
  const raw = outputForPrefix(outputs, 'raw/');
  const minified = outputForPrefix(outputs, 'minified/');
  return {
    raw: collectBundle(raw, includeDynamic, external),
    minified: collectBundle(minified, includeDynamic, external),
  };
}

/** Rewrites package-owned Wasm URLs so JavaScript closures price code rather than binary assets. */
export function externalizeGlyphWasmPlugin(): Plugin {
  return {
    name: 'externalize-package-wasm-for-size-measurement',
    transform(code, id) {
      const wasmAssets = [
        'bitmap-baker.wasm',
        'font-baker.wasm',
        'text-shaper.wasm',
        'text-shaper.wasm.gz',
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
  };
}

async function withinBundleDeadline<T>(label: string, task: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} exceeded ${bundleTimeoutMs} ms`)), bundleTimeoutMs);
  });
  try {
    return await Promise.race([task, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

type ViteOutput =
  Awaited<ReturnType<typeof viteBuild>> extends infer Result
    ? Result extends readonly (infer Output)[]
      ? Output
      : Result
    : never;

function outputForPrefix(outputs: readonly ViteOutput[], prefix: string): ViteOutput {
  const matches = outputs.filter((output) => {
    if (!('output' in output)) throw new Error('Package-size build unexpectedly entered watch mode');
    const chunks = output.output.filter((artifact) => artifact.type === 'chunk');
    return chunks.length > 0 && chunks.every(({ fileName }) => fileName.startsWith(prefix));
  });
  if (matches.length !== 1) throw new Error(`Package-size build did not emit exactly one ${prefix} output`);
  return matches[0]!;
}

function collectBundle(
  output: ViteOutput,
  includeDynamic: boolean,
  external: ((id: string) => boolean) | undefined,
): JavaScriptBundle {
  if (!('output' in output)) throw new Error('Package-size build unexpectedly entered watch mode');
  const chunks = output.output.filter((artifact) => artifact.type === 'chunk');
  const included = new Set<string>();
  const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const visit = (fileName: string): void => {
    if (included.has(fileName)) return;
    const chunk = byFileName.get(fileName);
    if (chunk === undefined && external?.(fileName) === true) return;
    if (chunk === undefined) throw new Error(`Package-size build omitted static chunk ${fileName}`);
    included.add(fileName);
    for (const imported of chunk.imports) visit(imported);
  };
  if (includeDynamic) {
    for (const chunk of chunks) included.add(chunk.fileName);
  } else {
    for (const chunk of chunks) if (chunk.isEntry) visit(chunk.fileName);
  }

  const selected = chunks.filter(({ fileName }) => included.has(fileName));
  if (selected.length === 0) throw new Error('Package-size entry emitted no JavaScript');
  return {
    bytes: new TextEncoder().encode(selected.map(({ code }) => code).join('\n')),
    includedModules: new Set(selected.flatMap(({ moduleIds }) => moduleIds)),
    excludedDynamicModules: new Set(
      chunks
        .filter(({ fileName }) => !included.has(fileName) && chunkIsDynamicallyReachable(fileName, chunks))
        .flatMap(({ moduleIds }) => moduleIds),
    ),
  };
}

function chunkIsDynamicallyReachable(
  fileName: string,
  chunks: ReadonlyArray<{ readonly dynamicImports: readonly string[] }>,
): boolean {
  return chunks.some(({ dynamicImports }) => dynamicImports.includes(fileName));
}
