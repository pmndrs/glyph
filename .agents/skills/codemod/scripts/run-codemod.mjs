import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import * as tsMorph from 'ts-morph';

const FORBIDDEN_SEGMENTS = new Set(['.git', 'dist', 'node_modules']);

export async function runCodemod({ codemod, project: projectPath, target, write = false }) {
  const targetRoot = path.resolve(target);
  const tsconfig = path.resolve(projectPath);
  const transformPath = path.resolve(codemod, 'transform.mjs');
  await Promise.all([access(targetRoot), access(tsconfig), access(transformPath)]);

  const migration = await import(`${pathToFileURL(transformPath).href}?run=${Date.now()}`);
  if (typeof migration.metadata?.id !== 'string' || typeof migration.transform !== 'function') {
    throw new TypeError('a codemod transform must export metadata.id and transform()');
  }

  const project = new tsMorph.Project({ tsConfigFilePath: tsconfig, skipAddingFilesFromTsConfig: false });
  const before = snapshot(project);
  await migration.transform({ project, renameSymbol: createSymbolRenamer(project), targetRoot, tsMorph });
  const after = snapshot(project);
  const changedFiles = changedPaths(before, after);
  for (const filePath of changedFiles) assertWritableTarget(targetRoot, filePath);
  if (write) await project.save();

  return Object.freeze({ id: migration.metadata.id, mode: write ? 'write' : 'dry-run', changedFiles });
}

function createSymbolRenamer(project) {
  return (declaration, replacement, options = {}) => {
    const original = declaration.getName?.();
    if (typeof original !== 'string' || original.length === 0 || typeof declaration.rename !== 'function') {
      throw new TypeError('renameSymbol() requires a named ts-morph declaration');
    }
    declaration.rename(replacement, { renameInComments: false, renameInStrings: false });
    if (options.comments !== false) renameCommentTokens(project, original, replacement);
  };
}

function renameCommentTokens(project, original, replacement) {
  const pattern = new RegExp(`(?<![$_\\p{ID_Continue}])${escapeRegExp(original)}(?![$_\\p{ID_Continue}])`, 'gu');
  for (const sourceFile of project.getSourceFiles()) {
    const text = sourceFile.getFullText();
    const variant =
      sourceFile.getExtension() === '.tsx' ? tsMorph.ts.LanguageVariant.JSX : tsMorph.ts.LanguageVariant.Standard;
    const scanner = tsMorph.ts.createScanner(tsMorph.ts.ScriptTarget.Latest, false, variant, text);
    const replacements = [];
    for (let token = scanner.scan(); token !== tsMorph.ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      if (
        token !== tsMorph.ts.SyntaxKind.SingleLineCommentTrivia &&
        token !== tsMorph.ts.SyntaxKind.MultiLineCommentTrivia
      ) {
        continue;
      }
      const start = scanner.getTokenPos();
      const end = scanner.getTextPos();
      const comment = text.slice(start, end);
      const renamed = comment.replace(pattern, replacement);
      if (renamed !== comment) replacements.push({ start, end, renamed });
    }
    for (const { start, end, renamed } of replacements.reverse()) sourceFile.replaceText([start, end], renamed);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function snapshot(project) {
  return new Map(project.getSourceFiles().map((sourceFile) => [sourceFile.getFilePath(), sourceFile.getFullText()]));
}

function changedPaths(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((filePath) => before.get(filePath) !== after.get(filePath)).sort();
}

function assertWritableTarget(targetRoot, filePath) {
  const relative = path.relative(targetRoot, filePath);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`codemod attempted to change a file outside its target: ${filePath}`);
  }
  const segments = relative.split(path.sep);
  const forbidden = segments.find((segment) => FORBIDDEN_SEGMENTS.has(segment));
  if (forbidden !== undefined)
    throw new Error(`codemod attempted to change forbidden ${forbidden} output: ${filePath}`);
}

function parseArguments(argv) {
  const values = { write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--write') values.write = true;
    else if (argument === '--codemod' || argument === '--project' || argument === '--target') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new TypeError(`${argument} requires a value`);
      values[argument.slice(2)] = value;
      index += 1;
    } else throw new TypeError(`unknown argument: ${argument}`);
  }
  for (const name of ['codemod', 'project', 'target']) {
    if (typeof values[name] !== 'string') throw new TypeError(`--${name} is required`);
  }
  return values;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await runCodemod(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
