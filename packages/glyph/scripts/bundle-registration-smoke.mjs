import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const smokeRoot = await mkdtemp(join(packageRoot, '.bundle-registration-'));
const techniqueIds = ['pmndrs.bitmap', 'pmndrs.msdf', 'pmndrs.slug'];

try {
  const scope = join(smokeRoot, 'node_modules', '@pmndrs');
  await mkdir(scope, { recursive: true });
  await symlink(packageRoot, join(scope, 'glyph'));
  await writeFile(join(smokeRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }));

  for (const [lane, subpaths] of [
    ['portable', ['raster/bitmap', 'raster/msdf', 'raster/slug']],
    ['three', ['three/bitmap', 'three/msdf', 'three/slug']],
  ]) {
    const imports = subpaths.map((subpath) => `import '@pmndrs/glyph/${subpath}';`).join('\n');
    const entry = join(smokeRoot, `${lane}.mjs`);
    const outDir = join(smokeRoot, lane);
    await writeFile(
      entry,
      `${imports}
       import { resolveRasterPlanProgram } from '@pmndrs/glyph/core';
       const ids = ${JSON.stringify(techniqueIds)};
       if (ids.some((id) => resolveRasterPlanProgram(id) === undefined)) {
         throw new Error('${lane} registration was tree-shaken');
       }
       process.stdout.write('${lane}-registered');`,
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
    assert.equal(outputs.length, 1, `${lane} emitted an unexpected bundle shape`);
    assert.equal(await execute(join(outDir, outputs[0])), `${lane}-registered`);
  }
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
