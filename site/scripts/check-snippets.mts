import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Every `ts`/`tsx` code block in the docs typechecks against the package, so
 * a snippet cannot drift from the API it describes. A fence may opt out with
 * `no-check` in its meta (`ts no-check`) when it is deliberately a fragment.
 *
 * Usage: node scripts/check-snippets.mts [--filter <path-prefix>] [--out <dir>]
 * With GLYPH_SOURCE set, the snippets resolve `@pmndrs/glyph/*` into that
 * checkout's `src`, the way the examples build does.
 */
const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const filter = option('--filter') ?? '';
const out = resolve(site, option('--out') ?? '.snippets');
const docs = join(site, 'docs');

function* mdxFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === 'components' || entry === 'assets') continue;
      yield* mdxFiles(path);
    } else if (entry.endsWith('.mdx')) yield path;
  }
}

interface Snippet {
  readonly page: string;
  readonly line: number;
  readonly file: string;
  readonly source: string;
}

const snippets: Snippet[] = [];
for (const path of mdxFiles(docs)) {
  const page = relative(docs, path);
  if (!page.startsWith(filter)) continue;
  const lines = readFileSync(path, 'utf8').split('\n');
  let open: { lang: string; meta: string; start: number } | undefined;
  let body: string[] = [];
  let ordinal = 0;
  for (const [number, line] of lines.entries()) {
    const fence = /^```(\w*)\s*(.*)$/.exec(line);
    if (open === undefined) {
      if (fence !== null && fence[1] !== '') open = { lang: fence[1], meta: fence[2] ?? '', start: number + 1 };
      body = [];
      continue;
    }
    if (fence !== null && fence[1] === '') {
      const { lang, meta, start } = open;
      open = undefined;
      if (!['ts', 'tsx', 'js', 'jsx'].includes(lang) || /\bno-check\b/.test(meta)) continue;
      ordinal += 1;
      const extension = lang.endsWith('x') ? 'tsx' : 'ts';
      const file = `${page.replace(/\.mdx$/, '').replaceAll('/', '__')}__${ordinal}.${extension}`;
      // The origin comment is line 1; snippet line n is file line n + 1.
      const source = `// ${page}:${start + 1}\n${body.join('\n')}\nexport {};\n`;
      snippets.push({ page, line: start, file, source });
      continue;
    }
    body.push(line);
  }
}

rmSync(out, { force: true, recursive: true });
mkdirSync(out, { recursive: true });
for (const snippet of snippets) writeFileSync(join(out, snippet.file), snippet.source);
writeFileSync(join(out, 'ambient.d.ts'), readFileSync(join(site, 'scripts', 'snippet-ambient.d.ts'), 'utf8'));

// Resolve the package the way the examples build does: the checkout named by GLYPH_SOURCE, else the workspace.
const paths: Record<string, string[]> = {};
const glyphSource = process.env['GLYPH_SOURCE'];
if (glyphSource !== undefined) {
  const manifest = JSON.parse(readFileSync(join(glyphSource, 'package.json'), 'utf8')) as {
    exports: Record<string, { source?: string } | string | null>;
  };
  for (const [subpath, entry] of Object.entries(manifest.exports)) {
    const source = entry !== null && typeof entry === 'object' ? entry.source : undefined;
    if (source === undefined) continue;
    paths[`@pmndrs/glyph${subpath.slice(1)}`] = [join(glyphSource, source)];
  }
}
writeFileSync(
  join(out, 'tsconfig.json'),
  JSON.stringify(
    {
      extends: relative(out, join(site, 'tsconfig.examples.json')),
      compilerOptions: {
        noUnusedLocals: false,
        noUnusedParameters: false,
        allowUnreachableCode: true,
        ...(glyphSource === undefined ? {} : { paths }),
      },
      include: ['./**/*'],
    },
    null,
    2,
  ),
);

const tsc = spawnSync(
  process.execPath,
  [
    join(site, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit',
    '--pretty',
    'false',
    '-p',
    join(out, 'tsconfig.json'),
  ],
  { encoding: 'utf8' },
);
const bySnippet = new Map(snippets.map((snippet) => [snippet.file, snippet] as const));
const findings: string[] = [];
for (const line of tsc.stdout.split('\n')) {
  const match = /^(.*?)\((\d+),(\d+)\): (error TS\d+: .*)$/.exec(line);
  if (match === null) continue;
  const file = relative(out, resolve(match[1]!));
  const snippet = bySnippet.get(file);
  if (snippet === undefined) {
    if (!file.startsWith('..')) findings.push(`${file}(${match[2]}): ${match[4]}`);
    continue;
  }
  findings.push(`${snippet.page}:${snippet.line + Number(match[2]) - 1}: ${match[4]}`);
}
const pages = new Set(findings.map((finding) => finding.split(':')[0]));
console.log(`${snippets.length} snippets checked, ${findings.length} errors on ${pages.size} pages`);
for (const finding of findings) console.log(finding);
process.exit(findings.length === 0 ? 0 : 1);
