import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(site, 'docs');
const staging = join(site, '.cache', 'doc-snippets');

/**
 * A documentation snippet that does not compile is a defect, not a doc. Every
 * fenced `ts`/`tsx` block under `site/docs` becomes one module and is
 * typechecked against the workspace `@pmndrs/glyph` source, so a published API
 * change breaks this check rather than the reader. Mark a fence `ts ignore` or
 * `tsx ignore` to exclude a deliberately partial example.
 */
const FENCE = /^```(tsx?)([^\n]*)\n([\s\S]*?)^```/gm;

interface Snippet {
  readonly file: string;
  readonly line: number;
  readonly module: string;
  readonly code: string;
}

async function mdxFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await mdxFiles(path)));
    else if (entry.name.endsWith('.mdx')) found.push(path);
  }
  return found.sort();
}

function extract(file: string, source: string): Snippet[] {
  const snippets: Snippet[] = [];
  for (const match of source.matchAll(FENCE)) {
    const [, language = 'ts', meta = '', code = ''] = match;
    if (meta.includes('ignore')) continue;
    const line = source.slice(0, match.index).split('\n').length;
    const stem = relative(docs, file).replaceAll(/[^a-z0-9]+/gi, '-');
    snippets.push({ file, line, module: `${stem}-${line}.${language}`, code });
  }
  return snippets;
}

const files = await mdxFiles(docs);
const snippets = (await Promise.all(files.map(async (file) => extract(file, await readFile(file, 'utf8'))))).flat();

if (snippets.length === 0) {
  console.info('No ts/tsx documentation snippets found under site/docs.');
  process.exit(0);
}

await rm(staging, { force: true, recursive: true });
await mkdir(staging, { recursive: true });
await Promise.all(snippets.map((snippet) => writeFile(join(staging, snippet.module), snippet.code)));

// Snippets are illustrative, so an unused local or parameter is not a defect;
// an unresolved import or a wrong call shape is exactly what this must catch.
const tsconfig = join(staging, 'tsconfig.json');
await writeFile(
  tsconfig,
  `${JSON.stringify(
    {
      extends: '../../tsconfig.json',
      compilerOptions: {
        noEmit: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
        // Snippets rarely import a Node builtin themselves, and without one
        // nothing pulls @types/node in for the package sources they reach.
        types: ['vite/client', 'node'],
      },
      include: ['*.ts', '*.tsx'],
    },
    null,
    2,
  )}\n`,
);

const result = spawnSync('tsc', ['-p', tsconfig], { cwd: site, encoding: 'utf8', shell: true });
if (result.status === 0) {
  console.info(`Typechecked ${snippets.length} documentation snippet(s) against @pmndrs/glyph.`);
  process.exit(0);
}

// Map every diagnostic back to the MDX file and the line its fence starts on.
const byModule = new Map(snippets.map((snippet) => [snippet.module, snippet]));
for (const line of `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n')) {
  const match = /^(?<module>[^\s(]+)\((?<row>\d+),(?<column>\d+)\)(?<rest>.*)$/.exec(line);
  const snippet = match?.groups === undefined ? undefined : byModule.get(match.groups['module']!.split('/').at(-1)!);
  if (snippet === undefined) {
    console.error(line);
    continue;
  }
  const row = snippet.line + Number(match!.groups!['row']);
  console.error(`${relative(site, snippet.file)}(${row},${match!.groups!['column']})${match!.groups!['rest']}`);
}
process.exit(1);
