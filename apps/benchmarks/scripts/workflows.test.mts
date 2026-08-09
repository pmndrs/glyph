import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { hasVitexecFailure } from './workflow-output.mts';

const execute = promisify(execFile);
const workflowScript = fileURLToPath(new URL('workflows.mts', import.meta.url));

test('indexes current specialized workflows from source metadata', async () => {
  const { stdout } = await execute(process.execPath, [workflowScript, 'list']);

  assert.match(stdout, /benchmark:presentation\n/);
  assert.match(stdout, /fixture:harfbuzz:provision\n/);
  assert.match(stdout, /release:size:check\n/);
  assert.doesNotMatch(stdout, /advanced-shaping-performance/);
  assert.doesNotMatch(stdout, /slug-fixed32-performance/);
});

test('describes requirements, writes, and source for one workflow', async () => {
  const { stdout } = await execute(process.execPath, [workflowScript, 'show', 'benchmark:presentation']);

  assert.match(stdout, /Requires: GPU-enabled Chromium and authenticated benchmark fixtures\./);
  assert.match(stdout, /Writes: Ignored browser caches only\./);
  assert.match(stdout, /Source: apps\/benchmarks\/scripts\/run-presentation-workload-matrix\.mts/);
});

test('treats Vitexec browser and injected-module errors as workflow failures', () => {
  assert.equal(hasVitexecFailure('logs:\n[log] presentation-ready'), false);
  assert.equal(hasVitexecFailure('logs:\n[error] injected probe failed'), true);
  assert.equal(hasVitexecFailure('logs:\n[page error] renderer failed'), true);
});
