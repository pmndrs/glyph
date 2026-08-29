import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runCodemod } from '../../scripts/run-codemod.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'glyph-paragraph-contract-'));
try {
  const glyph = path.join(root, 'packages/glyph/src');
  await mkdir(glyph, { recursive: true });
  await mkdir(path.join(root, 'app'));
  await mkdir(path.join(root, 'scripts'));
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { noEmit: true }, include: ['packages/**/*.ts', 'app/**/*.ts'] }),
  );
  await writeFile(
    path.join(glyph, 'text-properties.ts'),
    [
      'export interface ParagraphStyle { readonly fontSize?: number }',
      'export interface ParagraphConstraints { readonly width?: number }',
      'export type ParagraphLayoutPolicy = { readonly align?: string };',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(glyph, 'paragraph.ts'),
    [
      "import type { ParagraphConstraints } from './text-properties';",
      'export class Paragraph { layout(_: ParagraphConstraints): number { return 1; } }',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(glyph, 'layout.ts'),
    [
      'export interface ParagraphLayout { readonly x: Float32Array }',
      'export interface ParagraphLayoutInspection extends ParagraphLayout { readonly width: number }',
      'export function copyParagraphLayoutInspection(value: ParagraphLayoutInspection): ParagraphLayoutInspection {',
      '  return value;',
      '}',
      '',
    ].join('\n'),
  );
  const consumer = path.join(root, 'app/index.ts');
  const externalConsumer = path.join(root, 'app/external.ts');
  const scriptConsumer = path.join(root, 'scripts/benchmark.mts');
  const before = [
    "import type { ParagraphStyle, ParagraphConstraints, ParagraphLayoutPolicy } from '../packages/glyph/src/text-properties';",
    "import { Paragraph } from '../packages/glyph/src/paragraph';",
    "import { copyParagraphLayoutInspection, type ParagraphLayoutInspection } from '../packages/glyph/src/layout';",
    '// ParagraphStyle and ParagraphLayoutInspection are public names.',
    "const persisted = 'ParagraphStyle';",
    'void [copyParagraphLayoutInspection, persisted];',
    'export type Contract = [ParagraphStyle, ParagraphConstraints, ParagraphLayoutPolicy, ParagraphLayoutInspection];',
    'new (class extends Paragraph { read(value: ParagraphConstraints) { return this.layout(value); } })();',
    '',
  ].join('\n');
  await writeFile(consumer, before);
  await writeFile(
    externalConsumer,
    [
      "import type { ParagraphLayout, ParagraphLayoutPolicy } from '@pmndrs/glyph';",
      'export type Contract = [ParagraphLayout, ParagraphLayoutPolicy];',
      '',
    ].join('\n'),
  );
  await writeFile(
    scriptConsumer,
    [
      "import { Paragraph } from '../packages/glyph/src/paragraph';",
      'declare const paragraph: Paragraph;',
      'void paragraph.layout();',
      '',
    ].join('\n'),
  );

  const recipe = path.resolve('.agents/skills/codemod/codemods/2026-08-28-paragraph-contract');
  const dry = await runCodemod({ codemod: recipe, project: path.join(root, 'tsconfig.json'), target: root });
  assert.ok(dry.changedFiles.includes(consumer));
  assert.equal(await readFile(consumer, 'utf8'), before);

  await runCodemod({ codemod: recipe, project: path.join(root, 'tsconfig.json'), target: root, write: true });
  const output = await readFile(consumer, 'utf8');
  assert.match(output, /TextStyle/);
  assert.match(output, /Constraints/);
  assert.match(output, /ParagraphLayout/);
  assert.match(output, /GlyphLayoutInspection/);
  assert.match(output, /copyGlyphLayoutInspection/);
  assert.match(output, /this\.measure\(value\)/);
  assert.match(output, /TextStyle and GlyphLayoutInspection are public names/);
  assert.match(output, /const persisted = 'ParagraphStyle'/);
  const externalOutput = await readFile(externalConsumer, 'utf8');
  assert.match(externalOutput, /import type \{ GlyphLayout, ParagraphLayout \}/);
  assert.match(externalOutput, /\[GlyphLayout, ParagraphLayout\]/);
  assert.match(await readFile(scriptConsumer, 'utf8'), /paragraph\.measure\(\)/);

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
