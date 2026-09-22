/* @workflow { "name": "benchmark:workflow-check", "summary": "Verify benchmark workflow discovery, command forwarding, and isolated loopback ports.", "requirements": "Workspace Node toolchain.", "writes": "stdout" } */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { forwardedWorkflowArguments, workflowCommandArguments } from './workflow-arguments.mts';
import { hasVitexecFailure } from './workflow-output.mts';
import { assertLabsResultHasNoErrors } from './support/labs-result.mts';
import { LOOPBACK_HOST, selectLoopbackPort } from './support/loopback-port.mts';
import { selectPackageLabsSuite } from './support/package-labs-suite.mts';
import { packedArchiveDependency } from './support/packed-archive.mts';

const execute = promisify(execFile);
const workflowScript = fileURLToPath(new URL('workflows.mts', import.meta.url));

test('indexes current specialized workflows from source metadata', async () => {
  const { stdout } = await execute(process.execPath, [workflowScript, 'list']);

  assert.match(stdout, /benchmark:presentation\n/);
  assert.match(stdout, /benchmark:labs-package\n/);
  assert.match(stdout, /fixture:harfbuzz:provision\n/);
  assert.match(stdout, /release:size:check\n/);
  assert.doesNotMatch(stdout, /advanced-shaping-performance/);
  assert.doesNotMatch(stdout, /slug-fixed32-performance/);
});

test('describes requirements, writes, and source for one workflow', async () => {
  const { stdout } = await execute(process.execPath, [workflowScript, 'show', 'benchmark:presentation']);

  assert.match(stdout, /Requires: GPU-enabled Chromium and authenticated benchmark fixtures\./);
  assert.match(stdout, /Writes: Ignored browser caches only\./);
  assert.match(stdout, /Source: benches\/scripts\/run-presentation-workload-matrix\.mts/);
});

test('treats Vitexec browser and injected-module errors as workflow failures', () => {
  assert.equal(hasVitexecFailure('logs:\n[log] presentation-ready'), false);
  assert.equal(hasVitexecFailure('logs:\n[error] injected probe failed'), true);
  assert.equal(hasVitexecFailure('logs:\n[page error] renderer failed'), true);
});

test('rejects benchmark-body errors even when Labs exits successfully', () => {
  assert.doesNotThrow(() =>
    assertLabsResultHasNoErrors({
      files: [{ file: 'healthy.bench.ts', benchmarks: [{ runs: [{ name: 'healthy' }] }] }],
    }),
  );
  assert.throws(
    () =>
      assertLabsResultHasNoErrors({
        files: [
          {
            file: 'broken.bench.ts',
            benchmarks: [{ alias: 'layout', runs: [{ name: 'suffix-edit', error: { message: 'memory grew' } }] }],
          },
        ],
      }),
    /broken\.bench\.ts \/ layout \/ suffix-edit: memory grew/u,
  );
  assert.throws(() => assertLabsResultHasNoErrors({ files: [] }), /did not contain any benchmark runs/u);
});

test('routes package Labs by event and one explicit pull-request label', () => {
  assert.equal(selectPackageLabsSuite({ eventName: 'pull_request' }), 'smoke');
  assert.equal(
    selectPackageLabsSuite({ eventName: 'pull_request', labels: ['documentation', 'benchmark:layout'] }),
    'layout',
  );
  assert.equal(
    selectPackageLabsSuite({
      eventName: 'pull_request',
      labels: ['benchmark:measure', 'benchmark:full', 'benchmark:stress'],
    }),
    'full',
  );
  assert.equal(selectPackageLabsSuite({ eventName: 'push', ref: 'refs/heads/main' }), 'full');
  assert.equal(selectPackageLabsSuite({ eventName: 'workflow_dispatch', requestedSuite: 'glyphs' }), 'glyphs');
  assert.throws(
    () =>
      selectPackageLabsSuite({
        eventName: 'pull_request',
        labels: ['benchmark:layout', 'benchmark:measure'],
      }),
    /Select one focused benchmark label/u,
  );
  assert.throws(
    () => selectPackageLabsSuite({ eventName: 'workflow_dispatch', requestedSuite: 'unknown' }),
    /Unknown Package Labs suite/u,
  );
  assert.throws(
    () => selectPackageLabsSuite({ eventName: 'pull_request', labels: ['benchmark:typo'] }),
    /Unknown Package Labs suite/u,
  );
});

test('forwards runner options in the position each runner parses', () => {
  assert.deepEqual(forwardedWorkflowArguments(['--', '--cpu-profile', '/tmp/profile.cpuprofile']), [
    '--cpu-profile',
    '/tmp/profile.cpuprofile',
  ]);
  assert.deepEqual(workflowCommandArguments('node', 'probe.mts', ['--fixed'], ['--samples', '7']), [
    'probe.mts',
    '--fixed',
    '--samples',
    '7',
  ]);
  assert.deepEqual(workflowCommandArguments('vitexec', 'probe.ts', ['--gpu'], ['--cpu-profile', '/tmp/profile']), [
    '--gpu',
    '--cpu-profile',
    '/tmp/profile',
    'probe.ts',
  ]);
});

test('installs the archive emitted by pnpm pack regardless of package version', () => {
  assert.equal(packedArchiveDependency(['pmndrs-glyph-0.1.0.tgz']), 'file:archives/pmndrs-glyph-0.1.0.tgz');
  assert.equal(
    packedArchiveDependency(['pmndrs-glyph-0.0.0-canary-deadbeef-20260918.tgz']),
    'file:archives/pmndrs-glyph-0.0.0-canary-deadbeef-20260918.tgz',
  );
});

test('selects and releases an available loopback port for private Vite servers', async () => {
  const port = await selectLoopbackPort();
  assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65_535);

  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen({ exclusive: true, host: LOOPBACK_HOST, port }, resolve);
  });
  await new Promise<void>((resolve, reject) => {
    listener.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
});
