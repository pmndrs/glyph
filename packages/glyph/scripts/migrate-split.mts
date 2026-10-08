/* @workflow {
  "name": "glyph:split:migrate",
  "summary": "Preview the archived breakApart-to-split migration; pass --write to apply it.",
  "requirements": "Pinned ts-morph and workspace dependencies.",
  "writes": "Only with --write: Glyph source and typed repository call sites."
} */
/* @workflow {
  "name": "glyph:split:codemod-test",
  "summary": "Verify the split migration against repository and installed-consumer fixtures.",
  "requirements": "Pinned ts-morph and workspace dependencies.",
  "writes": "Temporary test fixtures, removed after verification.",
  "args": ["--test"]
} */
import { fileURLToPath } from 'node:url';
import { runCodemod } from '../../../.agents/skills/codemod/scripts/run-codemod.mjs';
import { runNode } from './support/command.mts';

const recipe = new URL('../../../.agents/skills/codemod/codemods/2026-09-24-text-split/', import.meta.url);
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--test') {
  await runNode(fileURLToPath(new URL('test.mjs', recipe)));
} else {
  if (args.some((argument) => argument !== '--write')) throw new Error('Expected --write or --test');
  const result = await runCodemod({
    codemod: fileURLToPath(recipe),
    project: fileURLToPath(new URL('project.json', recipe)),
    target: fileURLToPath(new URL('../../../', import.meta.url)),
    write: args.includes('--write'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
