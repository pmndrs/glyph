#!/usr/bin/env node
/* @workflow {"name": "docs:search", "args": [".agents/docs", "search"], "summary": "Find docs without reading whole files: `-- <terms…>` prints each matching paragraph under `path › Heading › Sub  [start-end]`; read that range next.", "requirements": "The repository-pinned Node.js runtime.", "writes": "stdout"} */
/* @workflow {"name": "docs:outline", "args": [".agents/docs", "outline"], "summary": "Heading tree with [start-end] line ranges: `-- <path>` for a file or directory, `-- <path>:<line>` for the sections containing that line.", "requirements": "The repository-pinned Node.js runtime.", "writes": "stdout"} */
/* @workflow {"name": "docs:decision", "args": [".agents/docs", "decision"], "summary": "Print one decision without loading the register: `-- D-123` or `-- <decision-slug>`.", "requirements": "The repository-pinned Node.js runtime.", "writes": "stdout"} */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import yaml from 'js-yaml';

/**
 * Context-conserving reads over a bundle. Large concepts and the register cost hundreds of kilobytes, so
 * an agent outlines or searches first, then reads only a line range. Every answer locates itself the same
 * way, as `path › Heading › Subheading  [start-end]`, so the reader always knows which section it is in
 * and which lines to open next. Paragraphs, the smallest Markdown block, are the unit of a search hit.
 */

const defaultSections = 8;
const pathLike = /\/|\.[a-z0-9]+$/iu;
const paragraphsPerSection = 3;
const paragraphLength = 400;

/**
 * A file's title, description, and heading tree with inclusive line ranges. With `path:line`, only the
 * sections containing that line. A directory lists each file with its title and description.
 */
export async function outline(bundle, target) {
  const [, file, line] = /^(.*?)(?::(\d+))?$/u.exec(target);
  const absolute = path.resolve(bundle, file);
  if ((await stat(absolute)).isDirectory()) {
    const rows = [];
    for (const entry of await markdownFiles(absolute)) {
      const { data } = await parse(entry);
      rows.push(`${relative(bundle, entry)}  ${data.title ?? ''}${data.description ? ` — ${data.description}` : ''}`);
    }
    return rows;
  }
  const document = await parse(absolute);
  const where = relative(bundle, absolute);
  if (line !== undefined) {
    const containing = document.sections.filter((section) => section.start <= line && line <= section.end);
    return containing.length === 0
      ? [`${where}:${line} is outside every section`]
      : containing.map(
          (section) => `${'  '.repeat(section.level - 1)}${section.title}  [${section.start}-${section.end}]`,
        );
  }
  const rows = [`${where}  ${document.data.title ?? ''} (${document.lines.length} lines)`];
  if (document.data.description) rows.push(`  ${document.data.description}`);
  for (const section of document.sections) {
    rows.push(`${'  '.repeat(section.level - 1)}${section.title}  [${section.start}-${section.end}]`);
  }
  return rows;
}

/**
 * Paragraphs containing every term, case-insensitively, grouped by their innermost section. Files whose
 * title or description match come first, as one line each, because they name the concept to open.
 */
export async function search(bundle, terms, options = {}) {
  const needles = terms.map((term) => term.toLowerCase()).filter(Boolean);
  if (needles.length === 0) throw new Error('search needs at least one term');
  // A path query names a file: it matches citations and links resolved to repository paths, so
  // `packages/glyph/src/three/text.ts` finds a concept that cites `../../../packages/glyph/src/three/text.ts`.
  const pathQuery = needles.length === 1 && pathLike.test(needles[0]) ? normalizePath(needles[0]) : undefined;
  const repository = await repositoryRoot(path.resolve(bundle));
  const matches = (text, targets = []) =>
    needles.every((needle) => text.toLowerCase().includes(needle)) ||
    (pathQuery !== undefined && targets.some((target) => target.toLowerCase().includes(pathQuery)));
  const concepts = [];
  const cited = [];
  const sections = [];
  for (const file of await markdownFiles(path.resolve(bundle))) {
    const document = await parse(file);
    const where = relative(bundle, file);
    const summary = `${document.data.title ?? ''} — ${document.data.description ?? ''}`;
    if (matches(summary)) concepts.push(`${where}  ${clip(summary, 200)}`);
    if (pathQuery !== undefined) {
      const hits = citations(document.data)
        .map((resource) => resolveTarget(file, resource, repository))
        .filter((target) => target !== undefined && target.toLowerCase().includes(pathQuery));
      if (hits.length > 0)
        cited.push(`${where}  ${document.data.title ?? ''} (cites ${[...new Set(hits)].join(', ')})`);
    }
    const grouped = new Map();
    for (const paragraph of document.paragraphs) {
      const targets = linkTargets(paragraph.text)
        .map((target) => resolveTarget(file, target, repository))
        .filter(Boolean);
      if (!matches(paragraph.text, targets)) continue;
      const home = innermost(document.sections, paragraph.start);
      const key = home === undefined ? 'top' : String(home.start);
      if (!grouped.has(key)) grouped.set(key, { file: where, document, home, paragraphs: [] });
      grouped.get(key).paragraphs.push(paragraph);
    }
    sections.push(...grouped.values());
  }
  const limit = options.limit ?? defaultSections;
  const rows = [];
  if (concepts.length > 0) rows.push('Concepts:', ...concepts.map((row) => `  ${row}`), '');
  if (cited.length > 0) rows.push('Cited as a source by:', ...cited.map((row) => `  ${row}`), '');
  for (const hit of sections.slice(0, limit)) {
    const range = hit.home === undefined ? '' : `  [${hit.home.start}-${hit.home.end}]`;
    const trail = breadcrumb(hit.document.sections, hit.paragraphs[0].start);
    // A file without headings, such as a Log Entry, is located by its title instead.
    const location = trail.length > 0 ? trail : [hit.document.data.title].filter(Boolean);
    rows.push(`${[hit.file, ...location].join(' › ')}${range}`);
    for (const paragraph of hit.paragraphs.slice(0, paragraphsPerSection)) {
      rows.push(
        `  [${paragraph.start}-${paragraph.end}] ${clip(paragraph.text.replace(/\s+/gu, ' ').trim(), paragraphLength)}`,
      );
    }
    if (hit.paragraphs.length > paragraphsPerSection) {
      rows.push(`  … ${hit.paragraphs.length - paragraphsPerSection} more in this section`);
    }
  }
  if (sections.length > limit) rows.push(`… ${sections.length - limit} more sections; add a term or pass --limit <n>`);
  if (rows.length === 0) rows.push('no matches');
  return rows;
}

/** One decision: a frozen register row by ID, or a decision file by slug, without loading the register. */
export async function decision(bundle, id) {
  const root = path.resolve(bundle);
  if (!/^D-\d+$/u.test(id)) {
    const file = path.join(root, 'planning', 'decisions', `${id}.md`);
    return [relative(bundle, file), ...(await readFile(file, 'utf8')).trimEnd().split('\n')];
  }
  const register = path.join(root, 'planning', 'decision-register.md');
  const document = await parse(register);
  const pattern = new RegExp(`^\\| ${id} +\\|`, 'u');
  const index = document.lines.findIndex((line) => pattern.test(line));
  if (index === -1) throw new Error(`${id} is not in the decision register`);
  const [, , text, status] = document.lines[index].split(/(?<!\\)\|/u).map((cell) => cell.trim());
  const superseding = [];
  for (const file of await markdownFiles(path.join(root, 'planning', 'decisions'))) {
    const { data } = await parse(file);
    if (Array.isArray(data.supersedes) && data.supersedes.includes(id)) superseding.push(relative(bundle, file));
  }
  return [
    `${[relative(bundle, register), ...breadcrumb(document.sections, index + 1)].join(' › ')}  [${index + 1}] ${id} — ${status}`,
    text,
    ...superseding.map((file) => `superseded by ${file}`),
  ];
}

/** Frontmatter, lines, heading sections with inclusive 1-based ranges, and paragraphs, skipping code fences. */
async function parse(file) {
  const text = await readFile(file, 'utf8');
  const lines = text.split('\n');
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(text);
  let data = {};
  try {
    data = (frontmatter && yaml.load(frontmatter[1])) || {};
  } catch {
    // A malformed block is the validator's to report; queries still read the body.
  }
  const bodyStart = frontmatter ? frontmatter[0].split('\n').length - 1 : 0;
  const sections = [];
  const paragraphs = [];
  let fence = false;
  let block;
  const close = (end) => {
    if (block !== undefined) paragraphs.push({ ...block, end, text: block.lines.join('\n') });
    block = undefined;
  };
  for (let index = bodyStart; index < lines.length; index += 1) {
    const line = lines[index];
    const number = index + 1;
    if (/^(```|~~~)/u.test(line)) fence = !fence;
    const heading = fence ? null : /^(#{1,6}) (.+)$/u.exec(line);
    if (heading) {
      close(number - 1);
      sections.push({ level: heading[1].length, title: heading[2], start: number });
      continue;
    }
    if (!fence && line.trim() === '') {
      close(number - 1);
      continue;
    }
    // Table rows and top-level list items are blocks of their own, so a hit in a long table or list
    // returns its row or item rather than the whole structure.
    if (!fence && /^(\||[-*+] |\d+\. )/u.test(line)) close(number - 1);
    if (block === undefined) block = { start: number, lines: [] };
    block.lines.push(line);
  }
  close(lines.length);
  sections.forEach((section, index) => {
    const next = sections.slice(index + 1).find((candidate) => candidate.level <= section.level);
    section.end = next === undefined ? lines.length : next.start - 1;
  });
  return { data, lines, sections, paragraphs };
}

function citations(data) {
  const sources = Array.isArray(data.sources) ? data.sources : [];
  return [data.resource, ...sources.map((source) => source?.resource)].filter((value) => typeof value === 'string');
}

function linkTargets(text) {
  return [...text.matchAll(/\]\(([^)\s#]+)/gu)].map((match) => match[1]).filter((target) => !/^[a-z]+:/iu.test(target));
}

/** A citation or link as a repository-relative path, or undefined for URLs and paths outside the repository. */
function resolveTarget(file, target, repository) {
  if (/^[a-z]+:/iu.test(target)) return undefined;
  const resolved = path.relative(repository, path.resolve(path.dirname(file), target));
  return resolved.startsWith('..') ? undefined : resolved.split(path.sep).join('/');
}

function normalizePath(query) {
  return query.replace(/^(\.\.?\/)+/u, '').replace(/\/$/u, '');
}

async function repositoryRoot(start) {
  for (let directory = start; ; directory = path.dirname(directory)) {
    try {
      await stat(path.join(directory, '.git'));
      return directory;
    } catch {
      if (path.dirname(directory) === directory) return start;
    }
  }
}

function breadcrumb(sections, line) {
  return sections.filter((section) => section.start <= line && line <= section.end).map((section) => section.title);
}

function innermost(sections, line) {
  return sections.filter((section) => section.start <= line && line <= section.end).at(-1);
}

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(absolute)));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(absolute);
  }
  return files.sort();
}

function clip(text, length) {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

function relative(bundle, file) {
  return path.relative(path.resolve(bundle), file).split(path.sep).join('/');
}

const usage =
  'usage: docs-query.mjs <bundle> outline <path[:line]> | search <terms…> [--limit n] | decision <D-n|slug>';

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [bundle, operation, ...rest] = process.argv.slice(2);
  try {
    if (bundle === undefined) throw new Error(usage);
    let rows;
    if (operation === 'outline' && rest[0] !== undefined) rows = await outline(bundle, rest[0]);
    else if (operation === 'search') {
      const limitIndex = rest.indexOf('--limit');
      const limit = limitIndex === -1 ? undefined : Number(rest[limitIndex + 1]);
      if (limit !== undefined && !(limit > 0)) throw new Error('--limit needs a positive number');
      const terms =
        limitIndex === -1 ? rest : rest.filter((_, index) => index !== limitIndex && index !== limitIndex + 1);
      rows = await search(bundle, terms, { limit });
    } else if (operation === 'decision' && rest[0] !== undefined) rows = await decision(bundle, rest[0]);
    else throw new Error(usage);
    process.stdout.write(`${rows.join('\n')}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
