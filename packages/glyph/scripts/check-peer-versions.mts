/* @workflow {
  "name": "glyph:peer-check",
  "summary": "Check published declarations, shaders and React lifecycles against minimum peers in an isolated install.",
  "requirements": "Workspace dependencies and network access. Optional --three, --fiber, --react and --typegpu exact versions override the declared floors. --browser also requires Playwright Chromium and verifies custom WebGPURenderer rendering.",
  "writes": "Temporarily builds Glyph and creates an ignored .cache/peer-versions consumer, which is removed on exit; never changes workspace dependencies or lockfile."
} */
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { checkReactBrowser } from './support/react-browser-check.mts';

const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const source = join(workspace, 'packages/glyph');
const exampleSource = join(workspace, 'packages/glyph-example-raster');
const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
const exampleManifest = JSON.parse(await readFile(join(exampleSource, 'package.json'), 'utf8'));
const { values } = parseArgs({
  options: {
    three: { type: 'string' },
    fiber: { type: 'string' },
    react: { type: 'string' },
    typegpu: { type: 'string' },
    browser: { type: 'boolean', default: false },
  },
});
const versions = Object.fromEntries(
  Object.entries(manifest.peerDependencies as Record<string, string>).map(([name, range]) => [
    name,
    range.split(' ')[0]?.replace(/^>=/, ''),
  ]),
);
for (const [option, name] of Object.entries({
  three: 'three',
  fiber: '@react-three/fiber',
  react: 'react',
  typegpu: 'typegpu',
})) {
  const override = values[option as 'three' | 'fiber' | 'react' | 'typegpu'];
  if (override !== undefined) versions[name] = override;
}

async function run(command: string, args: string[], cwd: string, env = process.env): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', env });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

const cache = join(workspace, '.cache/peer-versions');
await mkdir(cache, { recursive: true });
const consumer = await mkdtemp(join(cache, 'consumer-'));
const glyph = join(consumer, 'packages/glyph');
const example = join(consumer, 'packages/glyph-example-raster');
try {
  await run('pnpm', ['--filter', '@pmndrs/glyph', 'build'], workspace);
  await Promise.all([mkdir(glyph, { recursive: true }), mkdir(example, { recursive: true })]);
  for (const name of ['bin', 'src', 'dist', 'tests'])
    await cp(join(source, name), join(glyph, name), { recursive: true });
  for (const name of [
    'tsconfig.json',
    'tsconfig.types.json',
    'tsconfig.slug-shaders.json',
    'tsconfig.dist-peer-declarations.json',
  ]) {
    await cp(join(source, name), join(glyph, name));
  }
  for (const name of ['src', 'tests']) await cp(join(exampleSource, name), join(example, name), { recursive: true });
  for (const name of ['tsconfig.json', 'tsconfig.build.json']) await cp(join(exampleSource, name), join(example, name));
  await cp(join(workspace, 'tsconfig.base.json'), join(consumer, 'tsconfig.base.json'));
  await symlink(join(workspace, 'benches'), join(consumer, 'benches'), 'dir');
  await symlink(join(workspace, 'apps'), join(consumer, 'apps'), 'dir');
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await writeFile(
    join(consumer, 'pnpm-workspace.yaml'),
    'packages:\n  - packages/glyph\n  - packages/glyph-example-raster\nminimumReleaseAge: 0\n',
  );
  await writeFile(
    join(glyph, 'package.json'),
    JSON.stringify(
      {
        ...manifest,
        devDependencies: {
          ...manifest.devDependencies,
          ...versions,
          'react-dom': versions.react,
          '@types/react': `${versions.react?.split('.').slice(0, 2).join('.')}.0`,
          // v9's test renderer has an independent release sequence from Fiber.
          '@react-three/test-renderer': versions['@react-three/fiber']?.startsWith('9.')
            ? '9.1.1'
            : versions['@react-three/fiber'],
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(example, 'package.json'),
    JSON.stringify(
      {
        ...exampleManifest,
        devDependencies: {
          ...exampleManifest.devDependencies,
          three: versions.three,
          typegpu: versions.typegpu,
        },
      },
      null,
      2,
    ),
  );
  console.log('Checking peer versions:', versions, '\nConsumer:', consumer);
  await run('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile', '--strict-peer-dependencies'], consumer);
  for (const project of ['tsconfig.slug-shaders.json', 'tsconfig.types.json', 'tsconfig.dist-peer-declarations.json']) {
    await run('pnpm', ['exec', 'tsc', '-p', project, '--noEmit'], glyph);
  }
  await run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit'], example);
  await run(
    process.execPath,
    [
      '--test',
      'tests/package/slug-shader-source.test.mjs',
      'tests/package/typegpu-bitmap.test.mjs',
      'tests/package/typegpu-bitmap-parity.test.mjs',
      'tests/package/typegpu-three-authority.test.mjs',
      'tests/integration/three-shader.test.mjs',
      'tests/integration/react-lease-lifecycle.test.mjs',
      'tests/integration/text-mutation-span-alignment.test.mjs',
    ],
    glyph,
    { ...process.env, PMNDRS_GLYPH_R3F_ENTRY: 'root' },
  );
  const entries = versions['@react-three/fiber']?.startsWith('10.') ? ['root', 'webgpu'] : ['root'];
  if (entries.includes('webgpu')) {
    await run(
      process.execPath,
      [
        '--test',
        'tests/integration/react-lease-lifecycle.test.mjs',
        'tests/integration/text-mutation-span-alignment.test.mjs',
      ],
      glyph,
      { ...process.env, PMNDRS_GLYPH_R3F_ENTRY: 'webgpu' },
    );
  }
  if (values.browser) await checkReactBrowser(glyph, entries);
} finally {
  await rm(consumer, { recursive: true, force: true });
}
