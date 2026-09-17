#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import yaml from 'js-yaml';

import { packageDigest, workspacePackages } from './package-digest.mjs';

const actorPattern = /^(?:[^/:\s]+\/[^\s]+|human:[^\s]+|process:[^\s]+)$/u;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;
const datetimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export async function validateOkf(bundleRoot = '.', options = {}) {
  const root = path.resolve(bundleRoot);
  if (!(await isDirectory(root))) throw new Error(`bundle root does not exist: ${root}`);

  const conformance = [];
  const profile = [];
  const warnings = [];
  const packageConcepts = new Map();

  const concepts = (await markdownFiles(root)).filter(
    (filePath) => !['index.md', 'log.md'].includes(path.basename(filePath)),
  );
  for (const filePath of concepts) {
    let text;
    try {
      text = await readFile(filePath, 'utf8');
    } catch (error) {
      conformance.push(`${filePath}: not readable UTF-8 (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }

    const parsed = parseFrontmatter(filePath, text, conformance);
    if (parsed === undefined) continue;
    const { body, data } = parsed;

    if (typeof data.workspace_package === 'string') {
      const entries = packageConcepts.get(data.workspace_package) ?? [];
      entries.push([filePath, data]);
      packageConcepts.set(data.workspace_package, entries);
    }

    if (typeof data.type !== 'string' || data.type.trim().length === 0) {
      conformance.push(`${filePath}: missing non-empty type`);
    }
    if (hasOwn(data, 'timestamp')) profile.push(`${filePath}: legacy timestamp field`);
    if (/^# Citations[ \t]*$/mu.test(body)) profile.push(`${filePath}: legacy # Citations section`);

    const generated = data.generated;
    if (!isMapping(generated)) {
      profile.push(`${filePath}: missing generated mapping`);
    } else {
      if (typeof generated.by !== 'string' || !actorPattern.test(generated.by)) {
        profile.push(`${filePath}: generated.by is not a valid actor`);
      }
      if (!isIsoDatetime(generated.at)) profile.push(`${filePath}: generated.at is not an ISO 8601 datetime`);
    }

    const sourceIds = [];
    const sources = data.sources;
    if (sources !== undefined && !Array.isArray(sources)) {
      profile.push(`${filePath}: sources must be a list`);
    } else if (sources !== undefined) {
      for (const [index, source] of sources.entries()) {
        const label = `sources[${index}]`;
        if (!isMapping(source)) {
          profile.push(`${filePath}: ${label} must be a mapping`);
          continue;
        }
        if (String(source.resource ?? '').trim().length === 0) {
          profile.push(`${filePath}: ${label}.resource is required`);
        }
        if (typeof source.resource === 'string') {
          await validateResource(root, filePath, source.resource, `${label}.resource`, profile);
        }
        if (hasOwn(source, 'id')) {
          if (typeof source.id !== 'string' || source.id.length === 0) {
            profile.push(`${filePath}: ${label}.id must be a non-empty string`);
          }
          if (typeof source.id === 'string') sourceIds.push(source.id);
        }
        if (hasOwn(source, 'usage_count') && (!Number.isInteger(source.usage_count) || source.usage_count < 0)) {
          profile.push(`${filePath}: ${label}.usage_count must be a non-negative integer`);
        }
        if (hasOwn(source, 'last_modified') && !isIsoDate(source.last_modified)) {
          profile.push(`${filePath}: ${label}.last_modified must be an ISO date`);
        }
        if (hasOwn(source, 'usage_window'))
          validateWindow(filePath, source.usage_window, `${label}.usage_window`, profile);
      }
      if (new Set(sourceIds).size !== sourceIds.length) profile.push(`${filePath}: duplicate sources[].id values`);
    }
    if (hasOwn(data, 'usage_window')) validateWindow(filePath, data.usage_window, 'usage_window', profile);

    for (const footnote of [...body.matchAll(/\[\^([^\]]+)\]/gu)].map((match) => match[1])) {
      if (!sourceIds.includes(footnote))
        warnings.push(`${filePath}: footnote ${footnote} has no matching sources[].id`);
    }

    if (hasOwn(data, 'verified')) {
      const events = Array.isArray(data.verified) ? data.verified : [data.verified];
      for (const [index, event] of events.entries()) {
        if (!isMapping(event)) {
          profile.push(`${filePath}: verified[${index}] must be a mapping`);
          continue;
        }
        if (typeof event.by !== 'string' || !actorPattern.test(event.by)) {
          profile.push(`${filePath}: verified[${index}].by is not a valid actor`);
        }
        if (!isIsoDatetime(event.at)) profile.push(`${filePath}: verified[${index}].at is not an ISO 8601 datetime`);
      }
    }

    if (hasOwn(data, 'status') && !['draft', 'stable', 'deprecated'].includes(data.status)) {
      profile.push(`${filePath}: status must be draft, stable, or deprecated`);
    }
    if (hasOwn(data, 'stale_after') && !isIsoDate(data.stale_after)) {
      profile.push(`${filePath}: stale_after must be an ISO date`);
    }
    if (typeof data.resource === 'string') await validateResource(root, filePath, data.resource, 'resource', profile);

    if (data.type === 'Attested Computation') {
      if (typeof data.runtime !== 'string' || data.runtime.length === 0) {
        profile.push(`${filePath}: Attested Computation requires runtime`);
      }
      if (hasOwn(data, 'parameters')) {
        if (!Array.isArray(data.parameters)) {
          profile.push(`${filePath}: parameters must be a list`);
        } else {
          for (const [index, parameter] of data.parameters.entries()) {
            const valid =
              isMapping(parameter) &&
              typeof parameter.name === 'string' &&
              typeof parameter.type === 'string' &&
              typeof parameter.required === 'boolean';
            if (!valid) {
              profile.push(`${filePath}: parameters[${index}] requires string name/type and boolean required`);
            }
          }
        }
      }
      if (hasOwn(data, 'computation') && (typeof data.computation !== 'string' || data.computation.length === 0)) {
        profile.push(`${filePath}: computation must be a non-empty path`);
      }
      if (typeof data.computation === 'string') {
        await validateResource(root, filePath, data.computation, 'computation', profile);
      }
      for (const field of ['executor', 'attester']) {
        if (!hasOwn(data, field)) continue;
        const value = data[field];
        if (!isMapping(value) || String(value.resource ?? '').length === 0) {
          profile.push(`${filePath}: ${field} must contain resource`);
        }
        if (isMapping(value) && typeof value.resource === 'string') {
          await validateResource(root, filePath, value.resource, `${field}.resource`, profile);
        }
        if (field === 'executor' && isMapping(value) && hasOwn(value, 'receipt') && !Array.isArray(value.receipt)) {
          profile.push(`${filePath}: executor.receipt must be a list`);
        }
      }
    }

    if (typeof data.title !== 'string' || data.title.length === 0) warnings.push(`${filePath}: missing title`);
    if (typeof data.description !== 'string' || data.description.length === 0) {
      warnings.push(`${filePath}: missing description`);
    }
  }

  if (options.workspaceRoot !== undefined) {
    const workspaceRoot = path.resolve(options.workspaceRoot);
    if (!(await isDirectory(workspaceRoot))) throw new Error(`workspace root does not exist: ${workspaceRoot}`);
    const packages = new Map(await workspacePackages(workspaceRoot));
    for (const [name, packageRoot] of packages) {
      const entries = packageConcepts.get(name) ?? [];
      if (entries.length === 0) {
        profile.push(`workspace package ${name}: missing OKF Workspace Package concept`);
        continue;
      }
      if (entries.length > 1) {
        profile.push(
          `workspace package ${name}: duplicate concepts ${entries.map(([entryPath]) => entryPath).join(', ')}`,
        );
        continue;
      }
      const [[conceptPath, data]] = entries;
      if (data.type !== 'Workspace Package') {
        profile.push(`${conceptPath}: workspace package concept must use type Workspace Package`);
      }
      if (data.documentation_type !== 'reference') {
        profile.push(`${conceptPath}: workspace package concept must use documentation_type reference`);
      }
      const expectedResource = path.relative(path.dirname(conceptPath), packageRoot).split(path.sep).join('/');
      if (data.resource !== expectedResource) {
        profile.push(`${conceptPath}: resource must identify ${expectedResource}`);
      }
      const expectedDigest = await packageDigest(packageRoot);
      if (data.source_digest !== expectedDigest) {
        profile.push(`${conceptPath}: stale source_digest; expected ${expectedDigest}`);
      }
    }
    for (const [name, entries] of packageConcepts) {
      if (packages.has(name)) continue;
      for (const [conceptPath] of entries) {
        profile.push(`${conceptPath}: workspace_package ${name} does not exist in apps/*, benches, or packages/*`);
      }
    }
  }

  const rootIndex = path.join(root, 'index.md');
  if (await isFile(rootIndex)) {
    const text = await readFile(rootIndex, 'utf8');
    if (text.startsWith('---')) {
      const parsed = parseFrontmatter(rootIndex, text, conformance);
      if (parsed !== undefined) {
        const keys = Object.keys(parsed.data);
        if (keys.length !== 1 || keys[0] !== 'okf_version') {
          conformance.push(`${rootIndex}: root index frontmatter may contain only okf_version`);
        }
        if (String(parsed.data.okf_version) !== '0.2') profile.push(`${rootIndex}: expected okf_version 0.2`);
      }
    } else {
      warnings.push(`${rootIndex}: root index does not declare okf_version 0.2`);
    }
    if (!/^#{1,6} .+$/mu.test(text)) conformance.push(`${rootIndex}: index requires a heading`);
  }

  for (const filePath of (await markdownFiles(root)).filter(
    (candidate) => path.basename(candidate) === 'index.md' && candidate !== rootIndex,
  )) {
    const text = await readFile(filePath, 'utf8');
    if (/^---[ \t]*\r?$/u.test(text.split('\n', 1)[0] ?? '')) {
      conformance.push(`${filePath}: nested index must not have frontmatter`);
    }
    if (!/^#{1,6} .+$/mu.test(text)) conformance.push(`${filePath}: index requires a heading`);
  }

  for (const filePath of (await markdownFiles(root)).filter((candidate) => path.basename(candidate) === 'log.md')) {
    const text = await readFile(filePath, 'utf8');
    const h1s = [...text.matchAll(/^# (?!#).+$/gmu)];
    if (h1s.length !== 1 || !/^# (?!\d{4}-\d{2}-\d{2}$).+$/u.test(text.split(/\r?\n/u)[0] ?? '')) {
      conformance.push(`${filePath}: log requires exactly one H1 title`);
    }
    const dates = [...text.matchAll(/^## (\d{4}-\d{2}-\d{2})$/gmu)].map((match) => match[1]);
    if (dates.length === 0) conformance.push(`${filePath}: log requires H2 ISO date sections`);
    if (dates.join('\0') !== [...dates].sort().reverse().join('\0')) {
      conformance.push(`${filePath}: log dates must be newest-first`);
    }
    if (/^# \d{4}-\d{2}-\d{2}$/mu.test(text)) conformance.push(`${filePath}: date sections must use H2`);
  }

  for (const filePath of await markdownFiles(root)) {
    const text = await readFile(filePath, 'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/u.test(target)) continue;
      const local = target.split('#', 1)[0];
      if (local.length === 0) continue;
      const resolved = local.startsWith('/')
        ? path.join(root, local.slice(1))
        : path.resolve(path.dirname(filePath), local);
      if (!(await exists(resolved))) profile.push(`${filePath}: missing local link ${target}`);
    }
  }

  return { conformance, profile, warnings };
}

export function formatValidation(root, result) {
  const lines = [
    `OKF v0.2 validation for ${path.resolve(root)}`,
    `Conformance errors: ${result.conformance.length}`,
    ...result.conformance.map((error) => `  - ${error}`),
    `Producer-profile errors: ${result.profile.length}`,
    ...result.profile.map((error) => `  - ${error}`),
    `Warnings: ${result.warnings.length}`,
    ...result.warnings.map((warning) => `  - ${warning}`),
  ];
  return `${lines.join('\n')}\n`;
}

function parseFrontmatter(filePath, text, errors) {
  const match = /^---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n/su.exec(text);
  if (match === null) {
    errors.push(`${filePath}: missing parseable frontmatter block`);
    return undefined;
  }
  try {
    const data = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) ?? {};
    if (!isMapping(data)) {
      errors.push(`${filePath}: frontmatter must be a mapping`);
      return undefined;
    }
    return { body: text.slice(match[0].length), data, match };
  } catch (error) {
    errors.push(`${filePath}: invalid YAML (${error instanceof Error ? error.message : String(error)})`);
    return undefined;
  }
}

function validateWindow(filePath, value, label, errors) {
  if (!isMapping(value) || !isIsoDate(value.from) || !isIsoDate(value.to)) {
    errors.push(`${filePath}: ${label} must contain ISO dates from and to`);
    return;
  }
  if (String(value.from) > String(value.to)) errors.push(`${filePath}: ${label}.from must not be after .to`);
}

async function validateResource(root, filePath, value, label, errors) {
  if (value.length === 0 || /^(?:https?:\/\/|[a-z][a-z0-9+.-]*:)/iu.test(value) || /\s/u.test(value)) return;
  const local = value.split('#', 1)[0];
  if (local.length === 0) return;
  const resolved = local.startsWith('/')
    ? path.join(root, local.slice(1))
    : path.resolve(path.dirname(filePath), local);
  if (!(await exists(resolved))) errors.push(`${filePath}: missing local ${label} ${value}`);
}

function isIsoDate(value) {
  if (typeof value !== 'string') return false;
  const match = datePattern.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isIsoDatetime(value) {
  return typeof value === 'string' && datetimePattern.test(value) && !Number.isNaN(Date.parse(value));
}

function isMapping(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.hasOwn(value, key);
}

async function markdownFiles(root) {
  const files = [];
  await visit(root, files);
  return files.sort();
}

async function visit(directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(absolutePath, files);
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(absolutePath);
  }
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function isDirectory(filePath) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function parseArguments(arguments_) {
  const remaining = [...arguments_];
  const root = remaining.shift() ?? '.';
  let workspaceRoot;
  while (remaining.length > 0) {
    const option = remaining.shift();
    if (option !== '--workspace-root') throw new Error(`unknown option: ${option}`);
    workspaceRoot = remaining.shift();
    if (workspaceRoot === undefined) throw new Error('--workspace-root requires a path');
  }
  return { root, workspaceRoot };
}

if (isMainModule(import.meta.url)) {
  try {
    const { root, workspaceRoot } = parseArguments(process.argv.slice(2));
    const result = await validateOkf(root, { workspaceRoot });
    process.stdout.write(formatValidation(root, result));
    if (result.conformance.length > 0 || result.profile.length > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function isMainModule(url) {
  return process.argv[1] !== undefined && url === pathToFileURL(path.resolve(process.argv[1])).href;
}
