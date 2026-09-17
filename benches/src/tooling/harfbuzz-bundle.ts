import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

export const harfBuzzReleases = {
  '13.0.0': {
    sourceArchiveSha256: '1626ebc763d28f4bcca1531fef42e92ca995d45f8ad90ad2ae0b5d1a567fe67a',
    sourceCommit: 'a0fc099681a69ae40665fbea74982a2e9d7a5260',
  },
  '14.2.0': {
    sourceArchiveSha256: '94017020f96d025bb66ae91574e4cf334bcad23e8175a8a40565b3721bc2eaff',
    sourceCommit: 'b0ffab42d473eb380ad0fcf42730e0f1868cbc97',
  },
} as const;

export type HarfBuzzVersion = keyof typeof harfBuzzReleases;
export type HarfBuzzUtility = 'hb-info' | 'hb-shape' | 'hb-subset';

const utilities = ['hb-shape', 'hb-subset', 'hb-info'] as const satisfies readonly HarfBuzzUtility[];

type BundlePlatform = 'darwin' | 'linux';
type BundleArchitecture = 'arm64' | 'x64';

interface BundleFile {
  readonly executable: boolean;
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

interface HarfBuzzBundleManifest {
  readonly schemaVersion: 1;
  readonly harfBuzzVersion: HarfBuzzVersion;
  readonly target: {
    readonly platform: BundlePlatform;
    readonly arch: BundleArchitecture;
  };
  readonly source: {
    readonly archiveSha256: string;
    readonly commit: string;
  };
  readonly files: readonly BundleFile[];
}

export interface VerifiedHarfBuzzBundle {
  readonly directory: string;
  readonly manifest: HarfBuzzBundleManifest;
  readonly utilities: Readonly<Record<HarfBuzzUtility, string>>;
}

export function harfBuzzBundleTarget(platform: NodeJS.Platform, arch: NodeJS.Architecture): string {
  if (platform === 'darwin' && arch === 'arm64') return `${platform}-${arch}`;
  if (platform === 'linux' && arch === 'x64') return `${platform}-${arch}`;
  throw new Error(
    `no vendored HarfBuzz utilities are available for ${platform}-${arch}; supported targets are darwin-arm64 and linux-x64`,
  );
}

export async function verifyHarfBuzzBundle(options: {
  readonly bundleRoot: string;
  readonly version: HarfBuzzVersion;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
}): Promise<VerifiedHarfBuzzBundle> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = harfBuzzBundleTarget(platform, arch);
  const directory = resolve(options.bundleRoot, options.version, target);
  const manifest = parseManifest(await readManifest(resolve(directory, 'manifest.json')));
  const release = harfBuzzReleases[options.version];

  if (manifest.harfBuzzVersion !== options.version) {
    throw new Error(
      `HarfBuzz bundle version mismatch: expected ${options.version}, received ${manifest.harfBuzzVersion}`,
    );
  }
  if (manifest.target.platform !== platform || manifest.target.arch !== arch) {
    throw new Error(
      `HarfBuzz bundle target mismatch: expected ${platform}-${arch}, received ${manifest.target.platform}-${manifest.target.arch}`,
    );
  }
  if (
    manifest.source.archiveSha256 !== release.sourceArchiveSha256 ||
    manifest.source.commit !== release.sourceCommit
  ) {
    throw new Error(`HarfBuzz ${options.version} bundle source provenance does not match the pinned release`);
  }

  const fileByPath = new Map<string, BundleFile>();
  for (const file of manifest.files) {
    assertSafeRelativePath(file.path);
    if (fileByPath.has(file.path)) throw new Error(`duplicate HarfBuzz bundle file ${file.path}`);
    fileByPath.set(file.path, file);
    const absolutePath = resolve(directory, file.path);
    const fileStat = await stat(absolutePath).catch(() => undefined);
    if (fileStat === undefined || !fileStat.isFile()) throw new Error(`missing HarfBuzz bundle file ${file.path}`);
    if (fileStat.size !== file.size) {
      throw new Error(
        `HarfBuzz bundle size mismatch for ${file.path}: expected ${file.size}, received ${fileStat.size}`,
      );
    }
    const sha256 = createHash('sha256')
      .update(await readFile(absolutePath))
      .digest('hex');
    if (sha256 !== file.sha256) {
      throw new Error(`HarfBuzz bundle SHA-256 mismatch for ${file.path}: expected ${file.sha256}, received ${sha256}`);
    }
  }

  const utilityPaths = Object.fromEntries(
    await Promise.all(
      utilities.map(async (utility) => {
        const relativePath = `bin/${utility}`;
        const file = fileByPath.get(relativePath);
        if (file === undefined || !file.executable) {
          throw new Error(`HarfBuzz bundle manifest is missing executable ${relativePath}`);
        }
        const absolutePath = resolve(directory, relativePath);
        await assertPinnedExecutable(absolutePath, utility, options.version);
        return [utility, absolutePath] as const;
      }),
    ),
  ) as Readonly<Record<HarfBuzzUtility, string>>;

  if (!fileByPath.has('licenses/HarfBuzz-COPYING.txt')) {
    throw new Error('HarfBuzz bundle manifest is missing licenses/HarfBuzz-COPYING.txt');
  }

  return { directory, manifest, utilities: utilityPaths };
}

export async function installHarfBuzzBundle(options: {
  readonly bundleRoot: string;
  readonly cacheDirectory: string;
  readonly version: HarfBuzzVersion;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
}): Promise<VerifiedHarfBuzzBundle> {
  const verified = await verifyHarfBuzzBundle(options);
  await mkdir(dirname(options.cacheDirectory), { recursive: true });
  const stagingDirectory = await mkdtemp(
    resolve(dirname(options.cacheDirectory), `${options.version}-vendor-staging-`),
  );
  try {
    for (const file of verified.manifest.files) {
      const destination = installedPath(stagingDirectory, file.path);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve(verified.directory, file.path), destination);
      if (file.executable) await chmod(destination, 0o755);
    }
    for (const utility of utilities) {
      await assertPinnedExecutable(resolve(stagingDirectory, 'build/util', utility), utility, options.version);
    }
    await rm(options.cacheDirectory, { recursive: true, force: true });
    await rename(stagingDirectory, options.cacheDirectory);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
  return verified;
}

export async function isPinnedHarfBuzzExecutable(
  path: string,
  utility: HarfBuzzUtility,
  version: HarfBuzzVersion,
): Promise<boolean> {
  try {
    await assertPinnedExecutable(path, utility, version);
    return true;
  } catch {
    return false;
  }
}

function installedPath(cacheDirectory: string, bundlePath: string): string {
  if (bundlePath.startsWith('bin/')) return resolve(cacheDirectory, 'build/util', bundlePath.slice('bin/'.length));
  if (bundlePath.startsWith('lib/')) return resolve(cacheDirectory, 'build/lib', bundlePath.slice('lib/'.length));
  return resolve(cacheDirectory, bundlePath);
}

async function assertPinnedExecutable(path: string, utility: HarfBuzzUtility, version: HarfBuzzVersion): Promise<void> {
  const output = (await capture(path, ['--version'])).trim();
  const expected = `${utility} (HarfBuzz) ${version}`;
  if (output !== expected)
    throw new Error(`HarfBuzz utility version mismatch for ${utility}: expected ${expected}, received ${output}`);
}

async function readManifest(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`could not read HarfBuzz bundle manifest ${path}`, { cause: error });
  }
}

function parseManifest(value: unknown): HarfBuzzBundleManifest {
  if (!isObject(value)) throw new Error('HarfBuzz bundle manifest must be an object');
  const { schemaVersion, harfBuzzVersion, target, source, files } = value;
  if (schemaVersion !== 1) throw new Error(`unsupported HarfBuzz bundle manifest schema ${String(schemaVersion)}`);
  if (typeof harfBuzzVersion !== 'string' || !(harfBuzzVersion in harfBuzzReleases)) {
    throw new Error(`unsupported HarfBuzz bundle manifest version ${String(harfBuzzVersion)}`);
  }
  if (!isObject(target) || (target.platform !== 'darwin' && target.platform !== 'linux')) {
    throw new Error('HarfBuzz bundle manifest has an invalid target platform');
  }
  if (target.arch !== 'arm64' && target.arch !== 'x64') {
    throw new Error('HarfBuzz bundle manifest has an invalid target architecture');
  }
  if (!isObject(source) || typeof source.archiveSha256 !== 'string' || typeof source.commit !== 'string') {
    throw new Error('HarfBuzz bundle manifest has invalid source provenance');
  }
  if (!Array.isArray(files)) throw new Error('HarfBuzz bundle manifest files must be an array');
  const parsedVersion = harfBuzzVersion as HarfBuzzVersion;
  const parsedFiles = files.map((file, index): BundleFile => {
    if (
      !isObject(file) ||
      typeof file.path !== 'string' ||
      typeof file.sha256 !== 'string' ||
      typeof file.size !== 'number' ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      typeof file.executable !== 'boolean'
    ) {
      throw new Error(`HarfBuzz bundle manifest file ${index} is invalid`);
    }
    return { executable: file.executable, path: file.path, sha256: file.sha256, size: file.size };
  });
  return {
    schemaVersion,
    harfBuzzVersion: parsedVersion,
    target: { platform: target.platform, arch: target.arch },
    source: { archiveSha256: source.archiveSha256, commit: source.commit },
    files: parsedFiles,
  };
}

function assertSafeRelativePath(path: string): void {
  if (path.length === 0 || path.startsWith('/') || path.split(/[\\/]/u).some((part) => part === '' || part === '..')) {
    throw new Error(`unsafe HarfBuzz bundle path ${path}`);
  }
  const resolved = resolve('bundle-root', path);
  const root = resolve('bundle-root');
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`))
    throw new Error(`unsafe HarfBuzz bundle path ${path}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function capture(command: string, arguments_: readonly string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, arguments_, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolveOutput(stdout);
      else reject(new Error(`${command} exited with ${String(code)}: ${stderr}`));
    });
  });
}
