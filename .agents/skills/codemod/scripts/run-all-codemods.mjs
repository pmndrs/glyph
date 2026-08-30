import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runCodemod } from './run-codemod.mjs';

const defaultArchive = fileURLToPath(new URL('../codemods/', import.meta.url));

export async function runAllCodemods({ project, target, write = false, archive = defaultArchive }) {
  const recipes = await orderedRecipes(archive);
  const results = [];
  for (const recipe of recipes) {
    results.push(await runCodemod({ codemod: recipe.path, project, target, write }));
  }
  return Object.freeze({
    mode: write ? 'write' : 'check',
    changed: results.some((result) => result.changedFiles.length !== 0),
    results: Object.freeze(results),
  });
}

async function orderedRecipes(archive) {
  const entries = await readdir(archive, { withFileTypes: true });
  const recipes = [];
  for (const entry of entries
    .filter((value) => value.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const recipePath = path.join(archive, entry.name);
    const manifest = JSON.parse(await readFile(path.join(recipePath, 'recipe.json'), 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.id !== entry.name) {
      throw new TypeError(`${entry.name}/recipe.json must use schemaVersion 1 and an id matching its directory`);
    }
    recipes.push({ id: entry.name, path: recipePath });
  }
  return recipes;
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check' || argument === '--write') {
      if (values.mode !== undefined) throw new TypeError('choose exactly one of --check or --write');
      values.mode = argument.slice(2);
    } else if (argument === '--project' || argument === '--target') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new TypeError(`${argument} requires a value`);
      values[argument.slice(2)] = value;
      index += 1;
    } else throw new TypeError(`unknown argument: ${argument}`);
  }
  for (const name of ['project', 'target', 'mode']) {
    if (typeof values[name] !== 'string') throw new TypeError(`--${name} is required`);
  }
  return values;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = parseArguments(process.argv.slice(2));
    const result = await runAllCodemods({
      project: values.project,
      target: values.target,
      write: values.mode === 'write',
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (values.mode === 'check' && result.changed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
