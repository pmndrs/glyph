import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runCodemod } from '../../scripts/run-codemod.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'glyph-lifecycle-codemod-'));
try {
  await mkdir(path.join(root, 'packages/glyph/src/core'), { recursive: true });
  await mkdir(path.join(root, 'packages/glyph/src/three'), { recursive: true });
  await mkdir(path.join(root, 'packages/glyph/tests/types'), { recursive: true });
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022' },
      include: ['packages/**/*.ts', 'app/**/*.ts'],
    }),
  );
  await writeFile(
    path.join(root, 'packages/glyph/src/text-runtime.ts'),
    [
      'export interface TextRuntimeOptions {}',
      'export interface TextRuntime { createTextEngineHost(): TextEngineHost }',
      'export function createTextRuntime(): TextRuntime { return new TextRuntimeImpl() }',
      'class TextRuntimeImpl implements TextRuntime { createTextEngineHost(): TextEngineHost { return new TextEngineHost() } }',
      "import { TextEngineHost } from './core/host.js';",
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(root, 'packages/glyph/src/core/retained-session.ts'),
    [
      'export interface TextPlanTarget {}',
      'export interface TextEngineSessionOptions<T> { target: T }',
      'export interface SynchronousTextEngineSession {}',
      'export type SessionFor<T> = SynchronousTextEngineSession;',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(root, 'packages/glyph/src/core/host.ts'),
    [
      "import type { SessionFor, TextEngineSessionOptions, TextPlanTarget } from './retained-session.js';",
      'export class TextEngineHost {',
      '  createSession<T extends TextPlanTarget>(options: TextEngineSessionOptions<T>): SessionFor<T> { return options as never }',
      '  _createRawSession(): void {}',
      '}',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(root, 'packages/glyph/src/core.ts'),
    "export type { SessionFor } from './core/retained-session.js';\n",
  );
  await mkdir(path.join(root, 'app'), { recursive: true });
  const unrelated = [
    'interface AuthRecord { sessionId: string }',
    "export const kind = 'session';",
    "console.log('session', kind);",
    'export class TextEngine { run(): void {} }',
    'export interface HostPolicy { name: string }',
    '',
  ].join('\n');
  await writeFile(path.join(root, 'app/auth.ts'), unrelated);
  await writeFile(
    path.join(root, 'app/renderer.ts'),
    [
      "import { createTextRuntime, type TextRuntime } from '@pmndrs/glyph/core';",
      "export { TextEngineHost } from '@pmndrs/glyph/core';",
      'export function boot(): TextRuntime { return createTextRuntime() }',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(root, 'packages/glyph/src/three/runtime-domain.ts'),
    [
      'interface TextRuntime { dispose(): void }',
      'interface ReadyThreeRuntimeDomain { readonly runtime: TextRuntime }',
      "export const message = 'one Three text selection cannot span different renderer runtime domains';",
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(root, 'packages/glyph/tests/types/text-runtime-api.test.ts'),
    [
      "import { createTextRuntime, type TextRuntime } from '../../src/text-runtime.js';",
      "type Backend = 'webgpu' | 'webgl2';",
      'declare const adapter: { createSession(): void };',
      'const runtime: TextRuntime = createTextRuntime();',
      'const host = runtime.createTextEngineHost();',
      'const session = host.createSession({ target: {} });',
      'adapter.createSession();',
      'void session;',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(root, 'packages/glyph/src/core/engine-abi.ts'),
    [
      'interface ShaperExports {',
      '  createSession(sessionId: number): number;',
      '  reserveSession(sessionId: number): number;',
      '  disposeSession(sessionId: number): number;',
      '  sessionCount(): number;',
      '}',
      'interface Frame { sessionId: number }',
      'interface EngineAbi { defaultSessionTextCapacity: number }',
      "const kind = 'session';",
      'declare const functions: ShaperExports;',
      'declare const frame: Frame;',
      'declare const engine: EngineAbi;',
      'functions.createSession(frame.sessionId);',
      'void engine.defaultSessionTextCapacity;',
      'void kind;',
      '',
    ].join('\n'),
  );
  const recipe = path.resolve('.agents/skills/codemod/codemods/2026-08-28-text-engine-lifecycle');
  const result = await runCodemod({
    codemod: recipe,
    project: path.join(root, 'tsconfig.json'),
    target: root,
    write: true,
  });
  assert.ok(result.changedFiles.length >= 3);
  const output = await readFile(path.join(root, 'packages/glyph/tests/types/glyph-engine-api.test.ts'), 'utf8');
  assert.match(output, /createGlyphEngine/);
  assert.match(output, /GlyphEngine/);
  assert.match(output, /glyphEngine\.createBackend\(\)/);
  assert.match(output, /backend\.createRetainedPlan/);
  assert.match(output, /const retainedPlan =/);
  assert.match(output, /adapter\.createSession\(\)/);
  assert.match(output, /type Backend = 'webgpu' \| 'webgl2'/);
  const host = await readFile(path.join(root, 'packages/glyph/src/core/backend.ts'), 'utf8');
  assert.match(host, /export class GlyphBackend/);
  assert.match(host, /createRetainedPlan/);
  assert.match(host, /_createPlanTransport/);
  const core = await readFile(path.join(root, 'packages/glyph/src/core.ts'), 'utf8');
  assert.match(core, /from '\.\/core\/retained-plan\.js'/);
  const abi = await readFile(path.join(root, 'packages/glyph/src/core/engine-abi.ts'), 'utf8');
  assert.match(abi, /createRetainedPlan\(retainedPlanId/);
  assert.match(abi, /reserveRetainedPlan/);
  assert.match(abi, /disposeRetainedPlan/);
  assert.match(abi, /retainedPlanCount/);
  assert.match(abi, /frame\.retainedPlanId/);
  assert.match(abi, /defaultRetainedPlanTextCapacity/);
  assert.match(abi, /'retained-plan'/);
  assert.equal(await readFile(path.join(root, 'app/auth.ts'), 'utf8'), unrelated);
  const consumer = await readFile(path.join(root, 'app/renderer.ts'), 'utf8');
  assert.match(consumer, /import \{ createGlyphEngine, type GlyphEngine \} from '@pmndrs\/glyph\/core'/);
  assert.match(consumer, /export \{ GlyphBackend \} from '@pmndrs\/glyph\/core'/);
  assert.match(consumer, /boot\(\): GlyphEngine \{ return createGlyphEngine\(\) \}/);
  const engineDomain = await readFile(path.join(root, 'packages/glyph/src/three/engine-domain.ts'), 'utf8');
  assert.match(engineDomain, /readonly glyphEngine: GlyphEngine/);
  assert.match(engineDomain, /different Three engine domains/);
  assert.doesNotMatch(engineDomain, /runtime domain|renderer engine domain/);
  const repeated = await runCodemod({
    codemod: recipe,
    project: path.join(root, 'tsconfig.json'),
    target: root,
    write: true,
  });
  assert.deepEqual(repeated.changedFiles, []);
} finally {
  await rm(root, { recursive: true, force: true });
}
