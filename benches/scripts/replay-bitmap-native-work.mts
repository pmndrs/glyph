/* @workflow {
  "name": "benchmark:bitmap-native-work-replay",
  "summary": "Count native work while exactly replaying the frozen authenticated Bitmap wire trace.",
  "requirements": "Explicit --trace full-05/events.jsonl and new ignored --output directory; pinned mise and Rust toolchain.",
  "writes": "Only the specified ignored output directory; the full-05 trace remains read-only."
} */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedManifest = '09eb23a2fe41bad3578a4dfd8d42403ee66586da555f358f6317a477e3695412';
const expectedEvents = '51667f42fd2f4bde967dffab2b18048cf38a35174142952f09999815186d0fa6';
const expectedArchive = '28fd04139e792aa37fd963bf6100c091a4acdbd24417e2435f1a71d898ab37bb';
const expectedWasm = '01001ff67186294925137a0fc2deadb94eea294d13182f72ca59e7c164f667cd';
const expectedObserver = '486e0e87816b42a7969b8fcc151add92d4f07af98f9d2607878d2d2ccbb92879';
const expectedCaptureWorkflow = '9687336b92838f78c35c60b3cb795a00e1cb9fdad74468adf532c0c31826578f';
const expectedTransport = '11b6ddf6917ace16d9dbe8919d590565d09e436145adf5c24a6b9c1f016d57da';
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!['--trace', '--output'].includes(key ?? '') || value === undefined || args.has(key!)) {
    throw new Error('Supply --trace and --output as unique pairs');
  }
  args.set(key!, value);
}
if (!args.has('--trace') || !args.has('--output')) throw new Error('Supply --trace and --output');
const trace = resolve(args.get('--trace')!);
const directory = dirname(trace);
const output = resolve(args.get('--output')!);
assert.equal(basename(trace), 'events.jsonl');
const manifestBytes = await readFile(resolve(directory, 'capture-manifest.json'));
const eventBytes = await readFile(trace);
assert.equal(sha256(manifestBytes), expectedManifest, 'frozen capture manifest');
assert.equal(sha256(eventBytes), expectedEvents, 'frozen events');
const manifest = JSON.parse(manifestBytes.toString()) as {
  archiveSha256: string;
  eventCount: number;
  blobs: Record<string, { length: number; sha256: string }>;
  inputHashes: Record<string, string>;
  installedJsMembers: Record<string, string>;
  observerSha256: string;
  workflowSha256: string;
  nativeHarnessSha256: string;
  transportSha256: string;
};
assert.equal(manifest.archiveSha256, expectedArchive);
assert.equal(manifest.inputHashes.archive, expectedArchive);
assert.equal(manifest.inputHashes.installedWasm, expectedWasm);
assert.equal(manifest.observerSha256, expectedObserver);
assert.equal(manifest.inputHashes.driver, expectedObserver);
assert.equal(manifest.workflowSha256, expectedCaptureWorkflow);
assert.equal(manifest.transportSha256, expectedTransport);
assert.equal(manifest.eventCount, 6157);
assert.equal(Object.keys(manifest.installedJsMembers).length, 237);
assert.equal(Object.keys(manifest.blobs).length, 9227);
const actualBlobNames = (await readdir(resolve(directory, 'blobs'))).sort();
assert.deepEqual(actualBlobNames, Object.keys(manifest.blobs).sort(), 'all and only authenticated blobs');
for (const [name, identity] of Object.entries(manifest.blobs)) {
  if (name.includes('/') || name.includes('..')) throw new Error(`Invalid blob name ${name}`);
  const bytes = await readFile(resolve(directory, 'blobs', name));
  assert.equal(bytes.length, identity.length, `${name} length`);
  assert.equal(sha256(bytes), identity.sha256, `${name} SHA-256`);
}
const root = fileURLToPath(new URL('../..', import.meta.url));
const sourceFiles = [
  'packages/glyph/rust/shaper/src/engine/work_attribution.rs',
  'packages/glyph/rust/shaper/src/engine/positioning.rs',
  'packages/glyph/rust/shaper/src/engine/state.rs',
  'packages/glyph/rust/shaper/src/engine/codec_gather.rs',
  'packages/glyph/rust/shaper/src/engine/plan_packing.rs',
  'packages/glyph/rust/shaper/src/engine/ordered_plan.rs',
  'packages/glyph/rust/shaper/src/engine/transport.rs',
  'packages/glyph/rust/shaper/src/engine/transport/bitmap_replay_auth.rs',
  'benches/scripts/replay-bitmap-native-work.mts',
] as const;
const sourceHashes = Object.fromEntries(
  await Promise.all(sourceFiles.map(async (path) => [path, sha256(await readFile(resolve(root, path)))] as const)),
);
assert.equal(sourceHashes['packages/glyph/rust/shaper/src/engine/transport.rs'], expectedTransport);
assert.equal(
  sha256(await readFile(resolve(root, 'benches/labs/package/bitmap-native-replay.capture.mts'))),
  expectedObserver,
);
assert.equal(
  sha256(await readFile(resolve(root, 'benches/scripts/capture-bitmap-native-replay.mts'))),
  expectedCaptureWorkflow,
);
await mkdir(output);
const report = resolve(output, 'native-work-ledger.json');
await new Promise<void>((resolveRun, reject) => {
  const child = spawn(
    'cargo',
    [
      'test',
      '--lib',
      'engine::transport::bitmap_replay_auth::authenticate',
      '--',
      '--ignored',
      '--exact',
      '--nocapture',
    ],
    {
      cwd: resolve(root, 'packages/glyph/rust/shaper'),
      env: { ...process.env, GLYPH_BITMAP_REPLAY_TRACE: trace, GLYPH_BITMAP_WORK_REPORT: report },
      stdio: 'inherit',
    },
  );
  child.once('error', reject);
  child.once('close', (code) => (code === 0 ? resolveRun() : reject(new Error(`cargo exited ${String(code)}`))));
});
const ledger = JSON.parse(await readFile(report, 'utf8')) as { result: string; eventCount: number; totals: unknown[] };
assert.equal(ledger.result, 'exact-byte-pass');
assert.equal(ledger.eventCount, 6157);
assert.equal(ledger.totals.length, 6);
const afterSourceHashes = Object.fromEntries(
  await Promise.all(sourceFiles.map(async (path) => [path, sha256(await readFile(resolve(root, path)))] as const)),
);
assert.deepEqual(afterSourceHashes, sourceHashes, 'diagnostic sources changed during replay');
assert.equal(sha256(await readFile(trace)), expectedEvents, 'events changed during replay');
assert.equal(sha256(await readFile(resolve(directory, 'capture-manifest.json'))), expectedManifest);
await writeFile(
  resolve(output, 'identity.json'),
  JSON.stringify(
    {
      result: 'exact-byte-pass',
      frozen: {
        manifestSha256: expectedManifest,
        eventsSha256: expectedEvents,
        archiveSha256: expectedArchive,
        wasmSha256: expectedWasm,
        archivedObserverSha256: expectedObserver,
        archivedCaptureWorkflowSha256: expectedCaptureWorkflow,
        archivedNativeHarnessSha256: manifest.nativeHarnessSha256,
        transportSha256: expectedTransport,
        installedJsMembers: 237,
        blobs: 9227,
      },
      currentDiagnosticSourceHashes: sourceHashes,
      tools: { node: process.version },
    },
    null,
    2,
  ) + '\n',
);
process.stdout.write(`Bitmap native work replay: ${output}\n`);
