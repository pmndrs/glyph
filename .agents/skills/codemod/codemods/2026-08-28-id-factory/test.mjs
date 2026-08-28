import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { runCodemod } from '../../scripts/run-codemod.mjs';

const executeFile = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), 'glyph-id-codemod-'));
try {
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' }, include: ['app/**/*.ts'] }),
  );
  await writeFile(
    path.join(root, 'app/renderer.ts'),
    [
      "import { createRasterPolicyProgram, id, programId as makeProgram, RenderWireIdentityRegistry, resourceId, techniqueId } from '@pmndrs/glyph/core';",
      "import { defineRasterResourceId } from '@pmndrs/glyph';",
      "const BUFFER = id('buffer', 'vendor/value');",
      "const PLAN = id('retained-plan', 'vendor/plan');",
      "const RESOURCE_HANDLE = id('resource', 'vendor/live-resource');",
      "const TECHNIQUE = techniqueId('vendor.technique');",
      "const PROGRAM = makeProgram('vendor.technique', 'renderer');",
      "const RESOURCE = resourceId(defineRasterResourceId('vendor/resource'));",
      'const ids: RenderWireIdentityRegistry = new RenderWireIdentityRegistry();',
      "const SHADOW = ids.programId('vendor.technique', 'renderer', 'shadow');",
      'createRasterPolicyProgram({} as never, { identityRegistry: ids } as never);',
      "function record(id: number) { return makeProgram(id.toString(), 'renderer') }",
      'void [BUFFER, PLAN, RESOURCE_HANDLE, TECHNIQUE, PROGRAM, RESOURCE, SHADOW];',
      '',
    ].join('\n'),
  );
  const internalFactory = [
    "import type { ParagraphId } from '@pmndrs/glyph/core';",
    'export function paragraph(id: { paragraph(name: string): ParagraphId }): ParagraphId {',
    "  return id.paragraph('vendor/body');",
    '}',
    '',
  ].join('\n');
  await writeFile(path.join(root, 'app/internal.ts'), internalFactory);
  await writeFile(
    path.join(root, 'app/glyph.d.ts'),
    [
      "declare module '@pmndrs/glyph' {",
      '  export type Font<T = unknown> = { readonly technique: T };',
      '  export function defineRasterResourceId(value: string): any;',
      '}',
      "declare module '@pmndrs/glyph/core' {",
      '  export type ParagraphId = number;',
      '  export interface RenderIdFactory { program(...args: any[]): any; }',
      '  export const id: any;',
      '  export function compileRasterFont(...args: any[]): any;',
      '  export function createRasterPolicyProgram(...args: any[]): any;',
      '}',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(root, 'app/type-only.ts'),
    [
      "import type { Font } from '@pmndrs/glyph';",
      "import { compileRasterFont, RenderWireIdentityRegistry } from '@pmndrs/glyph/core';",
      'declare const font: Font<never>;',
      'const ids = new RenderWireIdentityRegistry();',
      'compileRasterFont(font, ids);',
      '',
    ].join('\n'),
  );
  const recipe = path.resolve('.agents/skills/codemod/codemods/2026-08-28-id-factory');
  const result = await runCodemod({
    codemod: recipe,
    project: path.join(root, 'tsconfig.json'),
    target: root,
    write: true,
  });
  assert.deepEqual(result.changedFiles, [path.join(root, 'app/renderer.ts'), path.join(root, 'app/type-only.ts')]);
  const output = await readFile(path.join(root, 'app/renderer.ts'), 'utf8');
  assert.match(output, /glyphId\.buffer\('vendor\/value'\)/);
  assert.match(output, /glyphId\.retainedPlan\('vendor\/plan'\)/);
  assert.match(output, /glyphId\.resourceHandle\('vendor\/live-resource'\)/);
  assert.match(output, /glyphId\.technique\('vendor\.technique'\)/);
  assert.match(output, /glyphId\.program\('vendor\.technique', 'renderer'\)/);
  assert.match(output, /glyphId\.resource\(defineRasterResourceId\('vendor\/resource'\)\)/);
  assert.match(output, /const ids: RenderIdFactory = glyphId/);
  assert.match(output, /ids\.program\('vendor\.technique', 'renderer', 'shadow'\)/);
  assert.match(output, /createRasterPolicyProgram\(\{\} as never, \{ ids \} as never\)/);
  assert.match(output, /function record\(id: number\) \{ return glyphId\.program\(id\.toString\(\), 'renderer'\) \}/);
  assert.match(output, /id as glyphId/);
  assert.doesNotMatch(output, /programId|resourceId|techniqueId|RenderWireIdentityRegistry/);
  assert.equal(await readFile(path.join(root, 'app/internal.ts'), 'utf8'), internalFactory);
  const typeOnlyOutput = await readFile(path.join(root, 'app/type-only.ts'), 'utf8');
  assert.match(typeOnlyOutput, /import \{[^}]*id[^}]*\} from '@pmndrs\/glyph\/core';/);
  assert.match(typeOnlyOutput, /import type \{ Font \} from '@pmndrs\/glyph';/);
  await executeFile(path.resolve('node_modules/.bin/tsc'), ['-p', path.join(root, 'tsconfig.json'), '--noEmit']);
  const repeated = await runCodemod({
    codemod: recipe,
    project: path.join(root, 'tsconfig.json'),
    target: root,
    write: true,
  });
  assert.deepEqual(repeated.changedFiles, []);
  await writeFile(
    path.join(root, 'app/raw-wire-id.ts'),
    "import { renderWireId } from '@pmndrs/glyph/core';\nrenderWireId('vendor/raw');\n",
  );
  await assert.rejects(
    runCodemod({
      codemod: recipe,
      project: path.join(root, 'tsconfig.json'),
      target: root,
      write: true,
    }),
    /cannot infer the domain of renderWireId/,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
