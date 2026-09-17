import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import type { ProductionJavaScriptMeasurement } from './production-app-size.ts';

const peerDependencies = ['react', '@react-three/fiber', 'three'] as const;

export async function measurePeerExternalizedReactAdapter(
  workspace = process.cwd(),
  entry = fileURLToPath(new URL('../../size-entries/react-runtime.ts', import.meta.url)),
): Promise<ProductionJavaScriptMeasurement> {
  const vitePath = createRequire(join(workspace, 'benches/package.json')).resolve('vite');
  const { build } = (await import(pathToFileURL(vitePath).href)) as typeof import('vite');
  const [raw, minified] = await Promise.all([
    bundleReactAdapter(build, workspace, entry, false),
    bundleReactAdapter(build, workspace, entry, 'oxc'),
  ]);

  return {
    id: 'react-runtime-js',
    label: 'React adapter JS',
    status: 'measured',
    format: 'javascript',
    sha256: createHash('sha256').update(minified).digest('hex'),
    rawBytes: raw.byteLength,
    minifiedBytes: minified.byteLength,
    gzipBytes: gzipSync(minified, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(minified, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
  };
}

async function bundleReactAdapter(
  build: typeof import('vite').build,
  workspace: string,
  entry: string,
  minify: false | 'oxc',
): Promise<Uint8Array> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    root: workspace,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    resolve: {
      alias: [
        { find: '@pmndrs/glyph/react', replacement: join(workspace, 'packages/glyph/dist/react.js') },
        { find: '@pmndrs/glyph', replacement: join(workspace, 'packages/glyph/dist/index.js') },
      ],
    },
    plugins: [
      {
        name: 'externalize-package-wasm-for-react-size-measurement',
        transform(code, id) {
          if (!id.includes('/packages/glyph/')) return;
          const transformed = code.replace(
            /new URL\((['"`])\.\.\/(?:\.\.\/)*(?:dist\/)?(bitmap-baker|font-baker|text-shaper|mtsdf-baker|slug-baker)\.wasm\1,\s*import\.meta\.url\)/g,
            (_match, quote: string, asset: string) =>
              `new URL(${quote}${asset}.wasm${quote}, ${quote}https://size.invalid/${quote})`,
          );
          if (transformed !== code) return transformed;
        },
      },
    ],
    build: {
      lib: { entry, formats: ['es'], fileName: 'entry' },
      minify,
      target: 'es2022',
      write: false,
      rollupOptions: {
        preserveEntrySignatures: 'strict',
        external: isPeerDependency,
      },
    },
  });
  const builds = Array.isArray(result) ? result : [result];
  const chunks = builds.flatMap((output) => {
    if (!('output' in output)) throw new Error('React adapter size build unexpectedly entered watch mode');
    return output.output.filter((artifact) => artifact.type === 'chunk');
  });
  const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const included = new Set<string>();
  const visit = (fileName: string): void => {
    if (included.has(fileName)) return;
    const chunk = byFileName.get(fileName);
    if (chunk === undefined && isPeerDependency(fileName)) return;
    if (chunk === undefined) throw new Error(`React adapter size build omitted static chunk ${fileName}`);
    included.add(fileName);
    for (const imported of chunk.imports) visit(imported);
  };
  for (const chunk of chunks) if (chunk.isEntry) visit(chunk.fileName);

  const measured = chunks.filter(({ fileName }) => included.has(fileName));
  const modules = measured.flatMap(({ moduleIds }) => moduleIds);
  for (const peer of peerDependencies) {
    const bundled = modules.find((id) => id.includes(`/node_modules/${peer}/`));
    if (bundled !== undefined) throw new Error(`React adapter size measurement bundled peer ${peer}: ${bundled}`);
  }
  if (!modules.some((id) => id.includes('/packages/glyph/dist/react'))) {
    throw new Error('React adapter size measurement did not include the built React entry');
  }

  const outputCode = measured.map(({ code: chunkCode }) => chunkCode).join('\n');
  if (outputCode.length === 0) throw new Error('React adapter size measurement emitted no JavaScript');
  return new TextEncoder().encode(outputCode);
}

function isPeerDependency(id: string): boolean {
  return peerDependencies.some((peer) => id === peer || id.startsWith(`${peer}/`));
}
