/* @workflow {
  "name": "benchmark:shaper-live-memory",
  "summary": "Capture bounded application operations against an authenticated diagnostic shaper in an installed Glyph package.",
  "requirements": "An authenticated diagnostic manifest, explicit --manifest and --output paths, and either --artifact <frozen .tgz> or --package-root <installed package>. The archive mode installs an isolated temporary consumer without scripts.",
  "writes": "One JSON report at --output; archive mode also creates and removes a temporary installed consumer. Package and diagnostic artifacts are read only."
} */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { installedPackageDependencies } from './support/package-labs-dependencies.mts';

const recordFields = [
  'version',
  'status',
  'requestedLive',
  'requestedPeak',
  'allocations',
  'reallocations',
  'deallocations',
  'cumulativeRequested',
] as const;
const recordBytes = recordFields.length * 4;
const cycles = 8;
const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (
    key === undefined ||
    !['--package-root', '--artifact', '--manifest', '--output'].includes(key) ||
    value === undefined ||
    args.has(key)
  ) {
    throw new Error('Supply --manifest, --output, and exactly one of --artifact or --package-root as path pairs');
  }
  args.set(key, value);
}
if (!args.has('--manifest') || !args.has('--output') || args.has('--artifact') === args.has('--package-root')) {
  throw new Error('Supply --manifest, --output, and exactly one of --artifact or --package-root');
}
const manifestPath = resolve(args.get('--manifest')!);
const output = resolve(args.get('--output')!);
const workflowFile = fileURLToPath(import.meta.url);
if (args.has('--artifact')) {
  const archive = resolve(args.get('--artifact')!);
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'glyph-shaper-live-memory-'));
  try {
    const archiveSha256 = sha256(await readFile(archive));
    const approved = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown);
    assert.equal(archiveSha256, approved.artifact.sha256, 'frozen package archive hash');
    await writeFile(
      resolve(temporaryRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'glyph-shaper-live-memory',
          private: true,
          type: 'module',
          dependencies: installedPackageDependencies(`file:${archive}`),
        },
        null,
        2,
      )}\n`,
    );
    const pnpm = process.env.npm_execpath;
    if (pnpm === undefined) throw new Error('Run the archive workflow through repository-pinned pnpm');
    await run(pnpm, ['install', '--ignore-scripts', '--config.confirmModulesPurge=false'], temporaryRoot);
    const packageRoot = resolve(temporaryRoot, 'node_modules/@pmndrs/glyph');
    const peerIdentities = Object.fromEntries(
      await Promise.all(
        ['@pmndrs/glyph', 'three', 'typegpu'].map(async (name) => {
          const metadata: unknown = JSON.parse(
            await readFile(resolve(temporaryRoot, 'node_modules', name, 'package.json'), 'utf8'),
          );
          if (!isObject(metadata) || metadata.name !== name || typeof metadata.version !== 'string') {
            throw new Error(`Installed consumer identity invalid: ${name}`);
          }
          return [name, metadata.version] as const;
        }),
      ),
    );
    await run(
      process.execPath,
      [workflowFile, '--package-root', packageRoot, '--manifest', manifestPath, '--output', output],
      dirname(workflowFile),
      {
        GLYPH_MEMORY_ARCHIVE_SHA256: archiveSha256,
        GLYPH_MEMORY_LOCK_SHA256: sha256(await readFile(resolve(temporaryRoot, 'pnpm-lock.yaml'))),
        GLYPH_MEMORY_PEER_IDENTITIES: JSON.stringify(peerIdentities),
      },
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  process.exit(0);
}
const packageRoot = resolve(args.get('--package-root')!);
const manifestBytes = await readFile(manifestPath);
const manifest = validateManifest(JSON.parse(manifestBytes.toString('utf8')) as unknown);
const fixtureFile = resolve(import.meta.dirname, '../labs/package/fixture.ts');
const fixtureFiles = [
  fixtureFile,
  resolve(import.meta.dirname, '../fixtures/rendering/inter-bitmap-16.font.glb'),
  resolve(import.meta.dirname, '../fixtures/rendering/dot-gothic-16-bitmap-16-32.font.glb'),
  resolve(import.meta.dirname, '../fixtures/rendering/fredoka-issue-216-bitmap-16.font.glb'),
];
const inputInventory = await inventoryInputs();
const [controlBytes, diagnosticBytes, shippingBytes] = await Promise.all([
  readFile(resolve(dirname(manifestPath), manifest.control.file)),
  readFile(resolve(dirname(manifestPath), manifest.diagnostic.file)),
  readFile(resolve(packageRoot, 'dist/text-shaper.wasm')),
]);
assert.equal(sha256(controlBytes), manifest.control.sha256, 'control artifact hash');
assert.equal(sha256(diagnosticBytes), manifest.diagnostic.sha256, 'diagnostic artifact hash');
assert.equal(sha256(shippingBytes), manifest.control.sha256, 'installed shipping shaper must equal control');
const packageMetadata = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8')) as unknown;
if (!isObject(packageMetadata) || packageMetadata.name !== '@pmndrs/glyph') {
  throw new Error('--package-root must identify an installed @pmndrs/glyph package');
}
const targetModule = await WebAssembly.compile(diagnosticBytes);
const facade = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/index.js')).href
)) as typeof import('@pmndrs/glyph');
const originalInstantiate = WebAssembly.instantiate;
let captured: WebAssembly.Instance | undefined;
try {
  WebAssembly.instantiate = (async (...arguments_: Parameters<typeof WebAssembly.instantiate>) => {
    const result = await originalInstantiate(...arguments_);
    if (arguments_[0] === targetModule) {
      if (captured !== undefined || !(result instanceof WebAssembly.Instance)) {
        throw new Error('Expected exactly one diagnostic shaper instance');
      }
      captured = result;
    }
    return result;
  }) as typeof WebAssembly.instantiate;
  await facade.glyph.init({ wasm: targetModule });
} finally {
  WebAssembly.instantiate = originalInstantiate;
}
if (captured === undefined || !facade.glyph.initialized)
  throw new Error('Diagnostic engine initialization was not captured');
const instance = captured as WebAssembly.Instance;
const memory = instance.exports.memory;
const allocate = instance.exports.pmndrs_glyph_shaper_alloc;
const deallocate = instance.exports.pmndrs_glyph_shaper_dealloc;
const snapshotExport = instance.exports.pmndrs_glyph_shaper_diagnostic_memory_snapshot;
const resetWindow = instance.exports.pmndrs_glyph_shaper_diagnostic_memory_reset_window;
if (
  !(memory instanceof WebAssembly.Memory) ||
  typeof allocate !== 'function' ||
  typeof deallocate !== 'function' ||
  typeof snapshotExport !== 'function' ||
  typeof resetWindow !== 'function'
) {
  throw new Error('Diagnostic instance lacks the required memory ABI');
}
const snapshotPointer = (allocate as (length: number) => number)(recordBytes);
if (snapshotPointer === 0) throw new Error('Could not allocate diagnostic snapshot scratch');

type Snapshot = Readonly<{
  requestedLive: number;
  requestedPeak: number;
  allocations: number;
  reallocations: number;
  deallocations: number;
  cumulativeRequested: number;
  wasmPages: number;
}>;
const snapshot = (): Snapshot => {
  const status = (snapshotExport as (pointer: number, length: number) => number)(snapshotPointer, recordBytes);
  if (status !== 0) throw new Error(`Diagnostic snapshot export failed: ${status}`);
  // WebAssembly.Memory may grow between reads; never retain its old ArrayBuffer/DataView.
  const view = new DataView(memory.buffer, snapshotPointer, recordBytes);
  const fields = Array.from({ length: 8 }, (_, index) => view.getUint32(index * 4, true));
  if (fields[0] !== 1 || fields[1] !== 0)
    throw new Error(`Invalid diagnostic record version/status: ${fields[0]}/${fields[1]}`);
  return {
    requestedLive: fields[2]!,
    requestedPeak: fields[3]!,
    allocations: fields[4]!,
    reallocations: fields[5]!,
    deallocations: fields[6]!,
    cumulativeRequested: fields[7]!,
    wasmPages: memory.buffer.byteLength / 65_536,
  };
};
const phases: Array<{ name: string; cycle: number; before: Snapshot; after: Snapshot }> = [];
function phase(name: string, cycle: number, operation: () => void): void {
  (resetWindow as () => void)();
  const before = snapshot();
  assert.equal(before.requestedPeak, before.requestedLive, `${name}: reset peak`);
  assert.equal(
    before.allocations + before.reallocations + before.deallocations + before.cumulativeRequested,
    0,
    `${name}: reset operation counters`,
  );
  operation();
  phases.push({ name, cycle, before, after: snapshot() });
}

process.env.GLYPH_LABS_PACKAGE_ROOT = packageRoot;
let fixture: typeof import('../labs/package/fixture.ts') | undefined;
let fontsDisposed = false;
try {
  // The fixture loads fonts, including outline decoders, only after interception has been removed.
  fixture = (await import(pathToFileURL(fixtureFile).href)) as typeof import('../labs/package/fixture.ts');
  const f = fixture;
  assert.equal(f.glyph, facade.glyph, 'fixture must reuse the initialized package singleton');

  let batch: ReturnType<typeof f.createTextBatch> | undefined;
  try {
    phase('cold-create-publish-1024', 0, () => {
      batch = f.createTextBatch(1024);
    });
    for (let cycle = 0; cycle < cycles; cycle++) {
      const word = cycle % 2 === 0 ? 'bravo' : 'alpha';
      phase('dense-edit-publish-1024', cycle, () => {
        for (const [index, label] of batch!.texts.entries()) {
          label.text = `${word} ${String(index).padStart(4, '0')}`;
          assert.equal(label.text, `${word} ${String(index).padStart(4, '0')}`);
        }
        batch!.scene.updateMatrixWorld(true);
        if (batch!.textGroup.error !== undefined) throw batch!.textGroup.error;
        assert(batch!.texts.every((label) => label.commitState().status === 'committed'));
      });
    }
  } finally {
    const ownedBatch = batch;
    if (ownedBatch !== undefined) phase('dense-root-teardown', 0, () => f.disposeTextBatch(ownedBatch));
  }

  let paragraph: ReturnType<typeof f.createParagraph> | undefined;
  try {
    const base = 'abcdefgh'.repeat(2_000);
    phase('cold-sparse-owner', 0, () => {
      paragraph = f.createParagraph(base);
    });
    let current = base;
    for (let cycle = 0; cycle < cycles; cycle++) {
      const position = cycle % 3 === 0 ? 0 : cycle % 3 === 1 ? base.length >> 1 : base.length - 1;
      const replacement = String.fromCharCode(88 + Math.floor(cycle / 3));
      const text = `${current.slice(0, position)}${replacement}${current.slice(position + 1)}`;
      assert.equal(text.length, base.length, 'sparse edit preserves UTF-16 length');
      assert.notEqual(text, current, 'sparse edit must change one character');
      phase('sparse-equal-length-ascii-replace-publish', cycle, () => {
        paragraph!.paragraph.text = text;
        assert.equal(paragraph!.paragraph.text, text);
        assert.equal(paragraph!.paragraph.measure().glyphCount, text.length);
        paragraph!.scene.updateMatrixWorld(true);
        if (paragraph!.textGroup.error !== undefined) throw paragraph!.textGroup.error;
        assert.equal(paragraph!.paragraph.commitState().status, 'committed');
      });
      current = text;
    }
  } finally {
    const ownedParagraph = paragraph;
    if (ownedParagraph !== undefined) phase('sparse-root-teardown', 0, () => f.disposeParagraph(ownedParagraph));
  }

  let edits: ReturnType<typeof f.createLabels> | undefined;
  try {
    phase('cold-count-change-owner', 0, () => {
      edits = f.createLabels(3);
    });
    for (let cycle = 0; cycle < cycles; cycle++) {
      phase('count-change-front-middle-tail', cycle, () => {
        for (const [index, label] of edits!.labels.entries()) {
          const base = 'ABCDEFGH';
          const position = [0, 4, 8][index]!;
          const text = `${base.slice(0, position)}${'x'.repeat((cycle % 2) + 1)}${base.slice(position)}`;
          label.text = text;
          assert.equal(label.text, text);
          assert.equal(label.measure().glyphCount, text.length);
        }
        edits!.scene.updateMatrixWorld(true);
        if (edits!.textGroup.error !== undefined) throw edits!.textGroup.error;
        assert(edits!.labels.every((label) => label.commitState().status === 'committed'));
      });
    }
  } finally {
    const ownedEdits = edits;
    if (ownedEdits !== undefined) phase('count-change-root-teardown', 0, () => f.disposeLabels(ownedEdits));
  }

  for (let cycle = 0; cycle < cycles; cycle++) {
    let source: ReturnType<typeof f.createLabels> | undefined;
    let copy: ReturnType<ReturnType<typeof f.createLabels>['labels'][number]['split']> | undefined;
    let copiedPayload: ReturnType<typeof copyPayload> | undefined;
    try {
      phase('cold-copy-source', cycle, () => {
        source = f.createLabels(1);
      });
      phase('immediate-prepared-read', cycle, () => {
        source!.labels[0]!.text = 'ABCDEFGH';
        assert.equal(source!.labels[0]!.measure().glyphCount, 8);
        assert.equal(
          source!.labels[0]!.readGlyphs((glyphs) => glyphs.glyphCount),
          8,
        );
      });
      phase('independent-split-copy', cycle, () => {
        copy = source!.labels[0]!.split();
        assert.equal(copy[0].count, 8);
        copiedPayload = copyPayload(copy[0]);
      });
      phase('copy-source-teardown', cycle, () => {
        f.disposeLabels(source!);
        source = undefined;
        assert.equal(copy![0].count, 8, 'independent copy survives source teardown');
        assert.deepEqual(copyPayload(copy![0]), copiedPayload, 'glyph identity and positions survive source teardown');
      });
    } finally {
      if (copy !== undefined)
        phase('independent-copy-teardown', cycle, () => {
          copy![1]?.dispose();
          copy![0].dispose();
        });
      const ownedSource = source;
      if (ownedSource !== undefined) phase('copy-source-final-teardown', cycle, () => f.disposeLabels(ownedSource));
    }
  }
  phase('fixture-font-teardown', 0, () => {
    f.font.dispose();
    f.monoFont.dispose();
    f.fredokaFont.dispose();
    fontsDisposed = true;
  });
  const retainedBaseline = snapshot();
  assert.deepEqual(
    await inventoryInputs(),
    inputInventory,
    'package JS, fixture, and workflow inputs changed during capture',
  );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify(
      {
        format: 'glyph-application-shaper-live-memory-v1',
        inputs: {
          packageRoot,
          manifest: manifestPath,
          manifestSha256: sha256(manifestBytes),
          diagnosticSha256: manifest.diagnostic.sha256,
          controlSha256: manifest.control.sha256,
          shippingSha256: sha256(shippingBytes),
          ...inputInventory,
          verifiedUnchangedAfterCapture: true,
          ...(process.env.GLYPH_MEMORY_ARCHIVE_SHA256 === undefined
            ? {}
            : {
                archiveSha256: process.env.GLYPH_MEMORY_ARCHIVE_SHA256,
                installedConsumerLockSha256: process.env.GLYPH_MEMORY_LOCK_SHA256,
                installedConsumerPeers: JSON.parse(process.env.GLYPH_MEMORY_PEER_IDENTITIES ?? '{}') as unknown,
              }),
        },
        tools: {
          node: process.version,
          pnpmUserAgent: process.env.npm_config_user_agent ?? null,
          diagnosticBuild: isObject(manifest.tools) ? manifest.tools : null,
        },
        method: {
          cycles,
          recordBytes,
          scope: 'captured engine Wasm instance only',
          exclusions: ['JS tokens', 'GPU', 'font decoder instances'],
          requestedPeak:
            'completed allocator-call high water; excludes Talc fragmentation and transient internal realloc peak',
          cumulativeRequested: 'full new size of successful realloc, not net growth',
          wasmPages: 'capacity, reported separately from requested live bytes',
        },
        phases,
        retainedBaseline,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`Shaper live-memory capture: ${output}\n`);
} finally {
  try {
    if (fixture !== undefined && !fontsDisposed) {
      try {
        fixture.font.dispose();
      } finally {
        try {
          fixture.monoFont.dispose();
        } finally {
          fixture.fredokaFont.dispose();
        }
      }
    }
  } finally {
    // Scratch is never inside a measured window and is the last engine allocation released here.
    (deallocate as (pointer: number, length: number) => void)(snapshotPointer, recordBytes);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
interface MemoryManifest {
  readonly artifact: { readonly sha256: string };
  readonly control: { readonly file: string; readonly sha256: string };
  readonly diagnostic: { readonly file: string; readonly sha256: string };
  readonly tools: Record<string, unknown>;
}
function validateManifest(value: unknown): MemoryManifest {
  if (
    !isObject(value) ||
    value.format !== 'glyph-shaper-memory-artifact-v1' ||
    !isObject(value.control) ||
    !isObject(value.diagnostic) ||
    !isObject(value.artifact) ||
    !isObject(value.tools)
  )
    throw new Error('Invalid diagnostic artifact manifest v1');
  for (const [name, part] of [
    ['control', value.control],
    ['diagnostic', value.diagnostic],
  ] as const) {
    if (
      typeof part.file !== 'string' ||
      part.file.length === 0 ||
      typeof part.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(part.sha256)
    ) {
      throw new Error(`Invalid ${name} artifact identity`);
    }
  }
  if (
    typeof value.artifact.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.artifact.sha256) ||
    value.artifact.shaperSha256 !== value.control.sha256
  ) {
    throw new Error('Manifest control differs from frozen package shaper identity');
  }
  const record = value.diagnostic.record;
  const proof = value.diagnostic.allocationProof;
  if (
    !isObject(record) ||
    record.byteLength !== recordBytes ||
    !Array.isArray(record.littleEndianU32) ||
    !assertRecordFields(record.littleEndianU32) ||
    !isObject(record.statusBits) ||
    record.statusBits.arithmeticOverflow !== 1 ||
    record.statusBits.arithmeticUnderflow !== 2 ||
    record.statusBits.sizeUnrepresentable !== 4 ||
    !isObject(proof) ||
    !validProofSnapshot(proof.before) ||
    !validProofSnapshot(proof.after)
  ) {
    throw new Error('Diagnostic record schema/version/allocator semantics differ from v1');
  }
  return {
    artifact: { sha256: value.artifact.sha256 },
    control: { file: value.control.file as string, sha256: value.control.sha256 as string },
    diagnostic: { file: value.diagnostic.file as string, sha256: value.diagnostic.sha256 as string },
    tools: value.tools,
  };
}
function assertRecordFields(value: readonly unknown[]): boolean {
  return value.length === recordFields.length && value.every((field, index) => field === recordFields[index]);
}
function validProofSnapshot(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === recordFields.length &&
    value.every((field) => Number.isInteger(field) && field >= 0 && field <= 0xffff_ffff) &&
    value[0] === 1 &&
    value[1] === 0
  );
}
async function inventoryInputs() {
  return {
    packageJs: await inventory(resolve(packageRoot, 'dist'), '.js'),
    fixtureSources: await Promise.all(
      fixtureFiles.map(async (path) => ({ path, sha256: sha256(await readFile(path)) })),
    ),
    workflowSource: { path: workflowFile, sha256: sha256(await readFile(workflowFile)) },
  };
}
function copyPayload(copy: {
  readonly count: number;
  glyphAt(index: number): {
    readonly key: unknown;
    readonly glyphId: number;
    readonly advance: number;
    readonly cluster: number;
  };
  readonly measurements: readonly { readonly shapedOrigin: { readonly x: number; readonly y: number } }[];
}) {
  assert.equal(copy.measurements.length, copy.count);
  return Array.from({ length: copy.count }, (_, index) => {
    const glyph = copy.glyphAt(index);
    const origin = copy.measurements[index]!.shapedOrigin;
    return {
      key: String(glyph.key),
      glyphId: glyph.glyphId,
      advance: glyph.advance,
      cluster: glyph.cluster,
      x: origin.x,
      y: origin.y,
    };
  });
}
async function run(
  command: string,
  arguments_: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>> = {},
): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, arguments_, { cwd, env: { ...process.env, ...environment }, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${String(code)}`)),
    );
  });
}
async function inventory(root: string, extension: string): Promise<Array<{ path: string; sha256: string }>> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && path.endsWith(extension)) files.push(path);
    }
  }
  await walk(root);
  files.sort();
  return Promise.all(files.map(async (path) => ({ path: relative(root, path), sha256: sha256(await readFile(path)) })));
}
