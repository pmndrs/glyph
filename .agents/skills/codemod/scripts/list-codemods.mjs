import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const archive = fileURLToPath(new URL('../codemods/', import.meta.url));

let entries = [];
try {
  entries = await readdir(archive, { withFileTypes: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const recipes = [];
for (const entry of entries
  .filter((value) => value.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name))) {
  const manifest = JSON.parse(await readFile(path.join(archive, entry.name, 'recipe.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.id !== entry.name) {
    throw new TypeError(`${entry.name}/recipe.json must use schemaVersion 1 and an id matching its directory`);
  }
  recipes.push({
    id: manifest.id,
    package: manifest.package,
    from: manifest.from,
    to: manifest.to,
    summary: manifest.summary,
  });
}

process.stdout.write(`${JSON.stringify(recipes, null, 2)}\n`);
