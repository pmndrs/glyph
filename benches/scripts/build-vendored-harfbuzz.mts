import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { arch as hostArch, platform as hostPlatform } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { harfBuzzReleases, type HarfBuzzUtility, type HarfBuzzVersion } from '../src/tooling/harfbuzz-bundle.ts';

const utilities = ['hb-shape', 'hb-subset', 'hb-info'] as const satisfies readonly HarfBuzzUtility[];
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const benchmarkRoot = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(benchmarkRoot, '..');
const dockerImage = 'glyph-harfbuzz-linux-x64-builder';
const ubuntuImage = 'ubuntu@sha256:829f6df217bcbae2b371026e81711d1a787c61b2967ad09d015063663ebafbf7';

const version = option('--version') as HarfBuzzVersion | undefined;
if (version === undefined || !(version in harfBuzzReleases)) {
  throw new Error(`--version must be one of ${Object.keys(harfBuzzReleases).join(', ')}`);
}
const target = option('--target');
if (target !== 'darwin-arm64' && target !== 'darwin-x64' && target !== 'linux-x64') {
  throw new Error('--target must be darwin-arm64, darwin-x64, or linux-x64');
}

const cacheRoot = resolve(benchmarkRoot, '.cache/harfbuzz-vendor');
const sourceRoot = resolve(cacheRoot, 'source', version);
const buildRoot = resolve(cacheRoot, 'build', version, target);
const outputRoot = resolve(benchmarkRoot, 'vendor/harfbuzz', version, target);

await prepareSource(version, sourceRoot);
if (!process.argv.includes('--package-only')) {
  await rm(buildRoot, { recursive: true, force: true });
  await mkdir(buildRoot, { recursive: true });
  if (target === 'linux-x64') await buildLinux(sourceRoot, buildRoot, version);
  else await buildDarwin(sourceRoot, buildRoot, target, version);
}
await packageBundle({ buildRoot, outputRoot, sourceRoot, target, version });
process.stdout.write(`${outputRoot}\n`);

async function prepareSource(releaseVersion: HarfBuzzVersion, destination: string): Promise<void> {
  const release = harfBuzzReleases[releaseVersion];
  const archive = resolve(cacheRoot, `harfbuzz-${releaseVersion}.tar.xz`);
  await mkdir(cacheRoot, { recursive: true });
  let archiveBytes: Buffer;
  try {
    archiveBytes = await readFile(archive);
  } catch {
    const response = await fetch(
      `https://github.com/harfbuzz/harfbuzz/releases/download/${releaseVersion}/harfbuzz-${releaseVersion}.tar.xz`,
    );
    if (!response.ok) throw new Error(`HarfBuzz source request failed with HTTP ${response.status}`);
    archiveBytes = Buffer.from(await response.arrayBuffer());
    await writeFile(archive, archiveBytes);
  }
  const sha256 = createHash('sha256').update(archiveBytes).digest('hex');
  if (sha256 !== release.sourceArchiveSha256) {
    throw new Error(`HarfBuzz source SHA-256 mismatch: expected ${release.sourceArchiveSha256}, received ${sha256}`);
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await run('tar', ['-xf', archive, '-C', destination, '--strip-components=1']);
}

async function buildLinux(sourceDirectory: string, output: string, releaseVersion: HarfBuzzVersion): Promise<void> {
  await run('docker', [
    'build',
    '--platform',
    'linux/amd64',
    '--tag',
    dockerImage,
    '-f',
    resolve(scriptDirectory, 'harfbuzz-vendor/linux-x64.Dockerfile'),
    resolve(scriptDirectory, 'harfbuzz-vendor'),
  ]);
  const environment = releaseVersion === '14.2.0' ? ['--env', 'HARFBUZZ_GPU_OPTION=-Dgpu=disabled'] : [];
  await run('docker', [
    'run',
    '--rm',
    '--platform',
    'linux/amd64',
    ...environment,
    '--volume',
    `${sourceDirectory}:/source:ro`,
    '--volume',
    `${output}:/output`,
    dockerImage,
  ]);
}

async function buildDarwin(
  sourceDirectory: string,
  output: string,
  buildTarget: 'darwin-arm64' | 'darwin-x64',
  releaseVersion: HarfBuzzVersion,
): Promise<void> {
  const targetArch = buildTarget.slice('darwin-'.length);
  if (hostPlatform() !== 'darwin' || hostArch() !== targetArch) {
    throw new Error(`native ${buildTarget} bundle generation requires a ${buildTarget} host`);
  }
  const buildDirectory = resolve(output, 'build');
  const options = mesonOptions(releaseVersion);
  await run('meson', [
    'setup',
    buildDirectory,
    sourceDirectory,
    '--buildtype=release',
    '--default-library=static',
    '--prefer-static',
    '-Db_lto=true',
    ...options,
  ]);
  await run('meson', ['compile', '-C', buildDirectory, ...utilities]);
  const provenance = resolve(output, 'provenance');
  await mkdir(provenance, { recursive: true });
  await writeFile(resolve(provenance, 'compiler.txt'), firstLine(await capture('cc', ['--version'])));
  await writeFile(resolve(provenance, 'meson.txt'), await capture('meson', ['--version']));
  await writeFile(resolve(provenance, 'glib.txt'), await capture('pkg-config', ['--modversion', 'glib-2.0']));
  for (const utility of utilities) {
    const executable = resolve(buildDirectory, 'util', utility);
    await run('strip', ['-S', executable]);
    await writeFile(resolve(provenance, `${utility}.version`), await capture(executable, ['--version']));
    await writeFile(resolve(provenance, `${utility}.otool`), await capture('otool', ['-L', executable]));
  }
}

async function packageBundle(options: {
  readonly buildRoot: string;
  readonly outputRoot: string;
  readonly sourceRoot: string;
  readonly target: 'darwin-arm64' | 'darwin-x64' | 'linux-x64';
  readonly version: HarfBuzzVersion;
}): Promise<void> {
  const buildDirectory = resolve(options.buildRoot, 'build');
  const binaryDirectory = resolve(options.outputRoot, 'bin');
  const licenseDirectory = resolve(options.outputRoot, 'licenses');
  await rm(options.outputRoot, { recursive: true, force: true });
  await mkdir(binaryDirectory, { recursive: true });
  await mkdir(licenseDirectory, { recursive: true });
  for (const utility of utilities) {
    const source = resolve(buildDirectory, 'util', utility);
    const output = resolve(binaryDirectory, utility);
    await cp(source, output);
    await chmod(output, 0o755);
    const actualVersion = (
      await readFile(resolve(options.buildRoot, 'provenance', `${utility}.version`), 'utf8')
    ).trim();
    const expectedVersion = `${utility} (HarfBuzz) ${options.version}`;
    if (actualVersion !== expectedVersion) {
      throw new Error(`built ${utility} version mismatch: expected ${expectedVersion}, received ${actualVersion}`);
    }
  }
  await cp(resolve(options.sourceRoot, 'COPYING'), resolve(licenseDirectory, 'HarfBuzz-COPYING.txt'));
  await writeFile(
    resolve(licenseDirectory, 'THIRD-PARTY-NOTICES.md'),
    [
      '# Third-party notices',
      '',
      `These utilities statically link HarfBuzz ${options.version} and GLib.`,
      '',
      '- HarfBuzz: https://github.com/harfbuzz/harfbuzz; license in `HarfBuzz-COPYING.txt`.',
      '- GLib: https://gitlab.gnome.org/GNOME/glib; LGPL-2.1-or-later.',
      '',
      'The complete authenticated build recipe is `benches/scripts/build-vendored-harfbuzz.mts`.',
      '',
    ].join('\n'),
  );

  const provenanceRoot = resolve(options.buildRoot, 'provenance');
  const dependencyAudit = Object.fromEntries(
    await Promise.all(
      utilities.map(async (utility) => {
        const lines = (
          await readFile(
            resolve(provenanceRoot, `${utility}.${options.target.startsWith('darwin-') ? 'otool' : 'ldd'}`),
            'utf8',
          )
        )
          .trim()
          .split('\n');
        if (lines[0]?.endsWith(':')) lines[0] = `${utility}:`;
        return [utility, lines];
      }),
    ),
  );
  const files = await Promise.all(
    [
      ...utilities.map((utility) => ({ executable: true, path: `bin/${utility}` })),
      { executable: false, path: 'licenses/HarfBuzz-COPYING.txt' },
      { executable: false, path: 'licenses/THIRD-PARTY-NOTICES.md' },
    ].map(async ({ executable, path }) => {
      const bytes = await readFile(resolve(options.outputRoot, path));
      return {
        executable,
        path,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.byteLength,
      };
    }),
  );
  const [platform, arch] = options.target.split('-') as ['darwin' | 'linux', 'arm64' | 'x64'];
  const manifest = {
    schemaVersion: 1,
    harfBuzzVersion: options.version,
    target: { platform, arch },
    source: {
      url: `https://github.com/harfbuzz/harfbuzz/releases/download/${options.version}/harfbuzz-${options.version}.tar.xz`,
      archiveSha256: harfBuzzReleases[options.version].sourceArchiveSha256,
      commit: harfBuzzReleases[options.version].sourceCommit,
    },
    build: {
      recipe: 'benches/scripts/build-vendored-harfbuzz.mts',
      baseImage: platform === 'linux' ? ubuntuImage : undefined,
      compiler: (await readFile(resolve(provenanceRoot, 'compiler.txt'), 'utf8')).trim(),
      meson: (await readFile(resolve(provenanceRoot, 'meson.txt'), 'utf8')).trim(),
      glib: (await readFile(resolve(provenanceRoot, 'glib.txt'), 'utf8')).trim(),
      buildType: 'release',
      defaultLibrary: 'static',
      preferStatic: true,
      lto: true,
      stripped: true,
      options: mesonOptions(options.version),
    },
    dependencies: dependencyAudit,
    files,
  };
  await writeFile(resolve(options.outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function mesonOptions(releaseVersion: HarfBuzzVersion): string[] {
  return [
    '-Dtests=disabled',
    '-Ddocs=disabled',
    '-Dutilities=enabled',
    '-Dglib=enabled',
    '-Dgobject=disabled',
    '-Dfreetype=disabled',
    '-Dcairo=disabled',
    '-Dchafa=disabled',
    '-Dicu=disabled',
    '-Dgraphite2=disabled',
    '-Ddirectwrite=disabled',
    '-Dcoretext=disabled',
    '-Dwasm=disabled',
    '-Draster=disabled',
    '-Dvector=disabled',
    '-Dintrospection=disabled',
    ...(releaseVersion === '14.2.0' ? ['-Dgpu=disabled'] : []),
  ];
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function firstLine(value: string): string {
  return `${value.trim().split('\n')[0]}\n`;
}

function capture(command: string, arguments_: readonly string[]): Promise<string> {
  return execute(command, arguments_, 'pipe');
}

async function run(command: string, arguments_: readonly string[]): Promise<void> {
  await execute(command, arguments_, 'inherit');
}

function execute(command: string, arguments_: readonly string[], stdio: 'inherit'): Promise<void>;
function execute(command: string, arguments_: readonly string[], stdio: 'pipe'): Promise<string>;
function execute(command: string, arguments_: readonly string[], stdio: 'inherit' | 'pipe'): Promise<string | void> {
  return new Promise((resolveExecution, reject) => {
    const child = spawn(command, arguments_, { cwd: repositoryRoot, stdio: stdio === 'inherit' ? 'inherit' : 'pipe' });
    let stdout = '';
    let stderr = '';
    if (stdio === 'pipe') {
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => (stdout += chunk));
      child.stderr?.on('data', (chunk: string) => (stderr += chunk));
    }
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolveExecution(stdio === 'pipe' ? stdout : undefined);
      else reject(new Error(`${command} exited with ${String(code)}${stderr.length > 0 ? `: ${stderr}` : ''}`));
    });
  });
}

/* @workflow { "name": "fixture:harfbuzz:vendor", "summary": "Build an authenticated platform HarfBuzz utility bundle for Git LFS.", "requirements": "Network access, Git LFS, and either macOS native build tools or Docker for Linux x64.", "writes": "benches/vendor/harfbuzz and ignored build caches.", "args": ["--version <13.0.0|14.2.0> --target <darwin-arm64|darwin-x64|linux-x64> [--package-only]"] } */
