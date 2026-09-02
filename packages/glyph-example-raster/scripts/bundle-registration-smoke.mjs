import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const emittedFiles = await readdir(join(packageRoot, 'dist'));
assert(!emittedFiles.includes('three.js'), 'build retained the removed dist/three.js adapter');

const { glyphExample } = await import('../dist/index.js');
const vite = await loadVite();
const smokeRoot = await mkdtemp(join(packageRoot, '.bundle-registration-'));

try {
  await prepareConsumer();
  const portable = await bundle(
    'portable',
    `
      import '@pmndrs/glyph-example-raster';
      import { resolveRasterPlanProgram } from '@pmndrs/glyph';
      if (resolveRasterPlanProgram(${JSON.stringify(glyphExample.id)}) === undefined) {
        throw new Error('portable root registration was tree-shaken');
      }
      process.stdout.write('portable-registered');
    `,
  );
  assert(!portable.code.includes('@pmndrs/glyph/three'), 'portable bundle imports the Three integration');
  assert(!portable.code.includes('three/tsl'), 'portable bundle imports the TSL implementation');
  assert(!portable.code.includes('typegpu'), 'portable bundle imports the TypeGPU implementation');
  assert.equal(await execute(portable.file), 'portable-registered');

  for (const [subpath, exportName, language] of [
    ['tsl', 'glyphExampleTslVariant', 'tsl'],
    ['typegpu', 'glyphExampleTypeGpuVariant', 'typegpu'],
  ]) {
    const shader = await bundle(
      `shader-${language}`,
      `
        import { ${exportName} as variant } from '@pmndrs/glyph-example-raster/${subpath}';
        process.stdout.write(variant.language);
      `,
    );
    assert(!shader.code.includes('@pmndrs/glyph/three'), `${subpath} bundle imports the Three integration`);
    assert(!shader.code.includes('registerThreeRasterPlanProgram'), `${subpath} bundle registers a renderer`);
    assert.equal(await execute(shader.file), language);
  }

  const three = await bundle(
    'explicit-three',
    `
      import { registerThreeRasterPlanProgram } from '@pmndrs/glyph/three';
      import { glyphExamplePlanProgram } from '@pmndrs/glyph-example-raster';
      import { glyphExampleTslVariant } from '@pmndrs/glyph-example-raster/tsl';

      registerThreeRasterPlanProgram({
        raster: glyphExamplePlanProgram.raster,
        schema: glyphExamplePlanProgram.schema,
        variant: {
          ...glyphExampleTslVariant,
          id: 'bundle-tsl',
          createMaterial() {
            throw new Error('bundle registration must not realize a material');
          },
        },
      });
      process.stdout.write('three-registered');
    `,
  );
  assert.equal(await execute(three.file), 'three-registered');
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}

async function bundle(name, source) {
  const entry = join(smokeRoot, `${name}.mjs`);
  const outDir = join(smokeRoot, name);
  await writeFile(entry, source);
  await vite.build({
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
        external(id) {
          return (
            id.startsWith('node:') ||
            id === '@pmndrs/glyph' ||
            id.startsWith('@pmndrs/glyph/') ||
            id === 'three' ||
            id.startsWith('three/') ||
            id === 'typegpu' ||
            id.startsWith('typegpu/')
          );
        },
        output: { codeSplitting: false },
        treeshake: true,
      },
    },
  });
  const files = (await readdir(outDir)).filter((file) => file.endsWith('.js'));
  assert.equal(files.length, 1, `${name} emitted an unexpected bundle shape`);
  const file = join(outDir, files[0]);
  return { file, code: await readFile(file, 'utf8') };
}

async function prepareConsumer() {
  const modules = join(smokeRoot, 'node_modules');
  const scope = join(modules, '@pmndrs');
  await mkdir(scope, { recursive: true });
  await writeFile(
    join(smokeRoot, 'package.json'),
    JSON.stringify({ name: 'bundle-consumer', private: true, type: 'module' }),
  );
  await Promise.all([
    symlink(packageRoot, join(scope, 'glyph-example-raster')),
    symlink(join(packageRoot, 'node_modules/@pmndrs/glyph'), join(scope, 'glyph')),
    symlink(join(packageRoot, 'node_modules/three'), join(modules, 'three')),
    symlink(join(packageRoot, 'node_modules/typegpu'), join(modules, 'typegpu')),
  ]);
}

async function execute(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { cwd: packageRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`bundle exited with ${signal ?? code}: ${stderr}`));
    });
  });
}

async function loadVite() {
  const packageRequire = createRequire(import.meta.url);
  const vitestRequire = createRequire(packageRequire.resolve('vitest/package.json'));
  return import(pathToFileURL(vitestRequire.resolve('vite')).href);
}
