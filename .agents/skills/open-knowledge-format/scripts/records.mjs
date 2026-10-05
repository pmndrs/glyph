#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import yaml from 'js-yaml';

/**
 * Append-only knowledge records: one file per log entry and one file per decision. A record is created
 * by exactly one change and named by its subject, never by a shared counter or a shared file, so
 * concurrent pull requests never conflict over them. The validator and the scaffolder share these rules.
 */

/** Scaffolded text the author must replace; the validator rejects any record that still contains it. */
export const placeholder = 'TODO(docs:new)';
/** Default number of records a listing prints. */
const listLimit = 20;
export const decisionStatuses = Object.freeze(['Proposed', 'Experiment', 'Deferred', 'Accepted', 'Superseded']);

const slugPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const logEntryName = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/u;

/** A `Log Entry` concept: dated by its file name, titled in frontmatter, and flat prose in the body. */
export function logEntryErrors(filePath, data, body) {
  const errors = [];
  if (path.basename(path.dirname(filePath)) !== 'log')
    errors.push(`${filePath}: a Log Entry lives in a log/ directory`);
  const name = logEntryName.exec(path.basename(filePath));
  if (name === null || !isIsoDate(name[1])) {
    errors.push(`${filePath}: name a Log Entry YYYY-MM-DD-<slug>.md`);
  }
  if (!isNonEmptyString(data.title)) errors.push(`${filePath}: a Log Entry needs a title`);
  if (/^#{1,6} /mu.test(body)) errors.push(`${filePath}: a Log Entry is flat prose; its title lives in frontmatter`);
  if (body.trim().length === 0) errors.push(`${filePath}: a Log Entry has no prose`);
  if (body.includes(placeholder) || JSON.stringify(data).includes(placeholder)) {
    errors.push(`${filePath}: replace the ${placeholder} scaffold text`);
  }
  return errors;
}

export function decisionErrors(filePath, data, body) {
  const errors = [];
  if (path.basename(path.dirname(filePath)) !== 'decisions') {
    errors.push(`${filePath}: a Decision lives in a decisions/ directory`);
  }
  if (!slugPattern.test(path.basename(filePath, '.md'))) {
    errors.push(`${filePath}: name a Decision by its subject slug (lowercase words, no number prefix)`);
  }
  if (!decisionStatuses.includes(data.decision_status)) {
    errors.push(`${filePath}: decision_status must be one of ${decisionStatuses.join(', ')}`);
  }
  if (!isIsoDate(data.decided)) errors.push(`${filePath}: decided must be a quoted ISO date`);
  if (data.supersedes !== undefined && !(Array.isArray(data.supersedes) && data.supersedes.every(isNonEmptyString))) {
    errors.push(`${filePath}: supersedes must be a list of decision IDs or decision file slugs`);
  }
  if (!/^## Decision[ \t]*$/mu.test(body)) errors.push(`${filePath}: a Decision states its rule under ## Decision`);
  if (body.includes(placeholder) || JSON.stringify(data).includes(placeholder)) {
    errors.push(`${filePath}: replace the ${placeholder} scaffold text`);
  }
  return errors;
}

/** A register that declares `frozen_after: D-<n>` accepts no rows numbered above it. */
export function frozenRegisterErrors(filePath, data, body) {
  if (data.frozen_after === undefined) return [];
  const limit = /^D-(\d+)$/u.exec(String(data.frozen_after));
  if (limit === null) return [`${filePath}: frozen_after must name a register ID such as D-372`];
  return [...body.matchAll(/^\| D-(\d+) +\|/gmu)]
    .filter((match) => Number(match[1]) > Number(limit[1]))
    .map(
      (match) =>
        `${filePath}: D-${match[1]} is past the frozen register; record it as a decision file with docs:new instead`,
    );
}

export async function createRecord(bundle, kind, slug, title, options = {}) {
  if (!slugPattern.test(slug)) throw new Error(`slug must be lowercase words joined by hyphens: ${slug}`);
  if (title.trim().length === 0) throw new Error('a record needs a title');
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  if (!isIsoDate(date)) throw new Error(`date must be YYYY-MM-DD: ${date}`);
  const [directory, file, text] =
    kind === 'log'
      ? [path.join(bundle, 'log'), `${date}-${slug}.md`, logTemplate(title, options.now)]
      : kind === 'decision'
        ? [path.join(bundle, 'planning', 'decisions'), `${slug}.md`, decisionTemplate(title, date, options.now)]
        : [];
  if (directory === undefined) throw new Error(`record kind must be log or decision: ${kind}`);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, file);
  // `wx` refuses to overwrite: a subject is recorded once, and a clash means the subject is already taken.
  await writeFile(target, text, { flag: 'wx' });
  return target;
}

function logTemplate(title, now = currentDatetime()) {
  return `---
type: Log Entry
title: ${JSON.stringify(title)}
generated:
  by: process:docs-new
  at: '${now}'
---

${placeholder} What changed and why, linking the concepts and decisions it touched.
`;
}

function currentDatetime() {
  return new Date().toISOString().replace(/\.\d+Z$/u, 'Z');
}

function decisionTemplate(title, date, now = currentDatetime()) {
  // JSON strings are valid YAML scalars, so any title survives without hand-rolled escaping.
  return `---
type: Decision
title: ${JSON.stringify(title)}
description: '${placeholder} One sentence stating the decision.'
decision_status: Proposed
decided: '${date}'
generated:
  by: process:docs-new
  at: '${now}'
---

# ${title}

## Decision

${placeholder} The rule, stated so a reviewer can check a change against it.

## Why

${placeholder} The forces and evidence behind it, with links to sources.

## Consequences

${placeholder} What it changes, what it supersedes (by D-ID or decision slug), and what stays open.
`;
}

/**
 * Newest-first listings: the readable chronology and decision index, derived instead of maintained.
 * Log listings filter by `since` (inclusive date) and `mentions` (case-insensitive text in title or body);
 * to find the commits that changed a file, `git log -- <path>` is exact.
 */
export async function listRecords(bundle, kind, options = {}) {
  if (kind === 'log') {
    const directory = path.join(bundle, 'log');
    const records = [];
    for (const file of (await markdownNames(directory)).sort().reverse()) {
      const date = file.slice(0, 10);
      if (options.since !== undefined && date < options.since) break;
      const text = await readFile(path.join(directory, file), 'utf8');
      if (options.mentions !== undefined && !text.toLowerCase().includes(options.mentions.toLowerCase())) continue;
      records.push({ date, title: String(frontmatter(text).title ?? ''), path: `log/${file}` });
    }
    return records;
  }
  if (kind === 'decision') {
    const directory = path.join(bundle, 'planning', 'decisions');
    const records = [];
    for (const file of await markdownNames(directory)) {
      const data = frontmatter(await readFile(path.join(directory, file), 'utf8'));
      if (data.type !== 'Decision') continue;
      records.push({
        date: String(data.decided ?? ''),
        status: data.decision_status,
        title: data.title,
        path: `planning/decisions/${file}`,
      });
    }
    return records.sort((left, right) => right.date.localeCompare(left.date) || left.path.localeCompare(right.path));
  }
  throw new Error(`record kind must be log or decision: ${kind}`);
}

function frontmatter(text) {
  return yaml.load(/^---\r?\n(.*?)\r?\n---/su.exec(text)?.[1] ?? '') ?? {};
}

async function markdownNames(directory) {
  try {
    return (await readdir(directory)).filter((file) => file.endsWith('.md'));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function isIsoDate(value) {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value) : null;
  if (match === null) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isMainModule(url) {
  return process.argv[1] !== undefined && url === pathToFileURL(path.resolve(process.argv[1])).href;
}

const usage =
  'usage: records.mjs <bundle> new <log|decision> <slug> <title…> | records.mjs <bundle> list <log|decision>';

if (isMainModule(import.meta.url)) {
  const [bundle, operation, kind, ...rest] = process.argv.slice(2);
  try {
    if (bundle === undefined || kind === undefined) throw new Error(usage);
    const root = path.resolve(bundle);
    if (operation === 'new') {
      const [slug, ...title] = rest;
      if (slug === undefined) throw new Error(usage);
      const target = await createRecord(root, kind, slug, title.join(' '));
      process.stdout.write(`created ${path.relative(process.cwd(), target)}; replace every ${placeholder}\n`);
    } else if (operation === 'list') {
      const option = (name) => {
        const index = rest.indexOf(name);
        return index === -1 ? undefined : rest[index + 1];
      };
      const since = option('--since');
      if (since !== undefined && !isIsoDate(since)) throw new Error('--since needs YYYY-MM-DD');
      // Capped by default so a listing never floods the reader; --all or --limit widen it.
      const limit = rest.includes('--all') ? Infinity : Number(option('--limit') ?? listLimit);
      if (!(limit > 0)) throw new Error('--limit needs a positive number');
      const records = await listRecords(root, kind, { since, mentions: option('--mentions') });
      for (const record of records.slice(0, limit)) {
        const status = record.status === undefined ? '' : `${record.status}\t`;
        process.stdout.write(`${record.date}\t${status}${record.title}\t${record.path}\n`);
      }
      const mentions = option('--mentions');
      if (records.length === 0 && mentions !== undefined && /\//u.test(mentions)) {
        process.stdout.write(
          `no log entries mention ${mentions}; \`git log --oneline -- ${mentions}\` lists the commits that changed it\n`,
        );
      }
      if (records.length > limit) {
        process.stdout.write(
          `… ${records.length - limit} older; narrow with --since or --mentions, or pass --limit <n> or --all\n`,
        );
      }
    } else {
      throw new Error(usage);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
