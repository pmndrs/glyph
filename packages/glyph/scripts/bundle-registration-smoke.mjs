import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'vite';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const smokeRoot = await mkdtemp(join(tmpdir(), 'glyph-bundle-registration-'));
const techniqueIds = ['pmndrs.bitmap', 'pmndrs.msdf', 'pmndrs.slug'];
const registryUrl = pathToFileURL(join(packageRoot, 'dist/internal/raster-codec-registry.js')).href;

try {
  const scope = join(smokeRoot, 'node_modules', '@pmndrs');
  await mkdir(scope, { recursive: true });
  await symlink(packageRoot, join(scope, 'glyph'));
  await symlink(fileURLToPath(new URL('../', import.meta.resolve('three'))), join(smokeRoot, 'node_modules', 'three'));
  await writeFile(join(smokeRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }));

  const entry = join(smokeRoot, 'portable.mjs');
  const outDir = join(smokeRoot, 'portable');
  await writeFile(
    entry,
    `import { bitmapCodec } from '@pmndrs/glyph/raster/bitmap';
       import { msdfCodec } from '@pmndrs/glyph/raster/msdf';
       import { slugCodec } from '@pmndrs/glyph/raster/slug';
       import { isRegisteredRasterCodec } from ${JSON.stringify(registryUrl)};
       const codecs = [bitmapCodec, msdfCodec, slugCodec];
       const ids = ${JSON.stringify(techniqueIds)};
       if (codecs.some((codec, index) => codec.raster.id !== ids[index] || !isRegisteredRasterCodec(codec))) {
         throw new Error('portable registration was tree-shaken');
       }
       process.stdout.write('portable-registered');`,
  );
  await build({
    configFile: false,
    root: smokeRoot,
    logLevel: 'silent',
    build: {
      emptyOutDir: true,
      minify: true,
      outDir,
      target: 'esnext',
      lib: { entry, formats: ['es'], fileName: 'bundle' },
      rollupOptions: {
        external: (id) =>
          id.startsWith('node:') ||
          id === 'three' ||
          id.startsWith('three/') ||
          id === 'typegpu' ||
          id.startsWith('typegpu/'),
        output: { codeSplitting: false },
        treeshake: true,
      },
    },
  });
  const outputs = (await readdir(outDir)).filter((file) => file.endsWith('.js'));
  const entryOutput = outputs.find((file) => file === 'bundle.js');
  assert.ok(entryOutput, `portable did not emit its registration entry: ${outputs.join(', ')}`);
  assert.equal(await execute(join(outDir, entryOutput)), 'portable-registered');
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}

async function execute(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { cwd: packageRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`bundle exited with ${signal ?? code}: ${stderr}`));
    });
  });
}
