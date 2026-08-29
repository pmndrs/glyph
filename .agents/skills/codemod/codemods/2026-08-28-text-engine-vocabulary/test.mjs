import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runCodemod } from '../../scripts/run-codemod.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'glyph-planner-vocabulary-'));
try {
  const core = path.join(root, 'packages/glyph/src/core');
  await mkdir(core, { recursive: true });
  const scripts = path.join(root, 'packages/glyph/scripts');
  await mkdir(scripts, { recursive: true });
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        allowJs: true,
        module: 'nodenext',
        moduleResolution: 'nodenext',
        noEmit: true,
        baseUrl: '.',
        paths: { '@pmndrs/glyph/core': ['packages/glyph/src/core.ts'] },
      },
      include: ['packages/**/*.ts', 'packages/**/*.mjs', 'app/**/*.ts', 'app/**/*.mjs'],
    }),
  );
  await writeFile(
    path.join(core, 'backend.ts'),
    [
      'export interface TextEngineFault { readonly paragraphId: number }',
      "export type TextEngineStatusCode = 'unknown';",
      'export class TextEngineStatusError extends Error {}',
      'export interface TextEngineStatusDetails { readonly fault: TextEngineFault }',
      'export function textEngineStatusErrorDetails(_: TextEngineStatusError): TextEngineStatusDetails {',
      '  return { fault: { paragraphId: 0 } };',
      '}',
      'export class GlyphBackend {',
      "  createRetainedPlan(): import('./retained-plan.js').SynchronousRetainedPlan { throw new Error(); }",
      '}',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(core, 'retained-plan.ts'),
    [
      'export interface TextEngineRenderPlanReader { u32(offset: number): number }',
      "export interface BorrowedTextEngineRenderPlan extends TextEngineRenderPlanReader { delivery: 'borrowed' }",
      'export interface TextEngineLimits { readonly maxParagraphs: number }',
      'export interface RetainedPlanPublishOptions { readonly semanticViews?: string }',
      'interface RetainedPlanBase { dispose(): void }',
      'export interface SynchronousRetainedPlan extends RetainedPlanBase {',
      '  publish(options?: RetainedPlanPublishOptions): unknown;',
      '}',
      'export interface AsyncRetainedPlan extends RetainedPlanBase { publish(): Promise<unknown> }',
      'export type RetainedPlanFor<T> = T extends Promise<unknown> ? AsyncRetainedPlan : SynchronousRetainedPlan;',
      'export interface RetainedPlanOptions { readonly limits: TextEngineLimits }',
      'export class RetainedPlanDisposedError extends Error {}',
      'export class TextEngineBackpressureError extends Error {}',
      'export class TextEngineTransportError extends Error {}',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(core, 'plan-view.ts'),
    [
      'export class TextEngineRenderPlanView {}',
      'export interface TextEngineBufferRecord { readonly id: number }',
      'export function readTextEngineBuffer(): TextEngineBufferRecord { return { id: 1 }; }',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(core, 'frame-wire.ts'),
    [
      'export interface TextEngineFrameUpdate { readonly retainedPlanId: number }',
      'export function compileTextEngineFrameUpdate(frame: TextEngineFrameUpdate): number {',
      '  return frame.retainedPlanId;',
      '}',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(core, 'render-policy.ts'),
    [
      "export type RetainedPlanHandle = number & { readonly brand: 'retained-plan' };",
      'export interface BackendIdFactory { retainedPlan(name: string): RetainedPlanHandle }',
      'export interface IdFactory { retainedPlan(name: string): RetainedPlanHandle }',
      "export const domain = 'retained-plan';",
      '',
    ].join('\n'),
  );
  await writeFile(path.join(core, 'layout-query-view.ts'), 'export function readTextEngineLayouts(): void {}\n');
  await writeFile(
    path.join(scripts, 'benchmark-rust-layout-engine.mjs'),
    'let sessionMemory;\nexport function saveMemory(value) { sessionMemory = value; return sessionMemory; }\n',
  );
  await writeFile(
    path.join(root, 'packages/glyph/src/core.ts'),
    [
      "export * from './core/backend.js';",
      "export * from './core/retained-plan.js';",
      "export * from './core/plan-view.js';",
      "export * from './core/frame-wire.js';",
      "export * from './core/render-policy.js';",
      '',
    ].join('\n'),
  );
  const consumerPath = path.join(root, 'app/renderer.ts');
  const before = [
    "import { GlyphBackend, TextEngineRenderPlanView, TextEngineStatusError, readTextEngineBuffer } from '@pmndrs/glyph/core';",
    '// SynchronousRetainedPlan emits a TextEngineRenderPlanView.',
    'const backend = new GlyphBackend();',
    'const retainedPlan = backend.createRetainedPlan();',
    'const view = new TextEngineRenderPlanView();',
    'readTextEngineBuffer();',
    "const persisted = 'retained-plan';",
    'void [retainedPlan, view, persisted, TextEngineStatusError];',
    '',
  ].join('\n');
  await writeFile(consumerPath, before);
  const javascriptConsumerPath = path.join(root, 'app/renderer.mjs');
  await writeFile(
    javascriptConsumerPath,
    [
      "import { TextEngineRenderPlanView, compileTextEngineFrameUpdate, id } from '@pmndrs/glyph/core';",
      "const handle = id.retainedPlan('consumer/planner');",
      'compileTextEngineFrameUpdate({ retainedPlanId: handle });',
      'new TextEngineRenderPlanView();',
      "const persisted = 'retained-plan';",
      'void persisted;',
      '',
    ].join('\n'),
  );

  const recipe = path.resolve('.agents/skills/codemod/codemods/2026-08-28-text-engine-vocabulary');
  const dry = await runCodemod({ codemod: recipe, project: path.join(root, 'tsconfig.json'), target: root });
  assert.ok(dry.changedFiles.includes(consumerPath));
  assert.equal(await readFile(consumerPath, 'utf8'), before);

  await runCodemod({ codemod: recipe, project: path.join(root, 'tsconfig.json'), target: root, write: true });
  const output = await readFile(consumerPath, 'utf8');
  assert.match(output, /GlyphEngineStatusError/);
  assert.match(output, /RenderPlanView/);
  assert.match(output, /backend\.createPlanner\(\)/);
  assert.match(output, /readRenderPlanBuffer\(\)/);
  assert.match(output, /RenderPlanner emits a RenderPlanView/);
  assert.match(output, /const persisted = 'retained-plan'/);
  assert.doesNotMatch(output, /TextEngine|SynchronousRetainedPlan|createRetainedPlan/);
  const javascriptOutput = await readFile(javascriptConsumerPath, 'utf8');
  assert.match(javascriptOutput, /RenderPlanView/);
  assert.match(javascriptOutput, /compilePlannerFrameUpdate/);
  assert.match(javascriptOutput, /id\.planner\('consumer\/planner'\)/);
  assert.match(javascriptOutput, /plannerId: handle/);
  assert.match(javascriptOutput, /const persisted = 'retained-plan'/);
  const policy = await readFile(path.join(core, 'render-policy.ts'), 'utf8');
  assert.match(policy, /PlannerHandle/);
  assert.match(policy, /planner\(name: string\)/);
  assert.match(policy, /'planner'/);
  const backend = await readFile(path.join(core, 'backend.ts'), 'utf8');
  assert.match(backend, /\.\/render-planner\.js/);
  const benchmark = await readFile(path.join(scripts, 'benchmark-rust-layout-engine.mjs'), 'utf8');
  assert.match(benchmark, /plannerMemory/);
  assert.doesNotMatch(benchmark, /sessionMemory/);
  await readFile(path.join(core, 'render-planner.ts'), 'utf8');
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
