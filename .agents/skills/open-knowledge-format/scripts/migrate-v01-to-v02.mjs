#!/usr/bin/env node

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import yaml from 'js-yaml';

const actorPattern = /^(?:[^/:\s]+\/[^\s]+|human:[^\s]+|process:[^\s]+)$/u;
const datetimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export async function migrateV01ToV02(bundleRoot, actor, generatedAt = new Date().toISOString().replace('.000Z', 'Z')) {
  const root = path.resolve(bundleRoot);
  if (!(await isDirectory(root))) throw new Error(`bundle root does not exist: ${root}`);
  if (!actorPattern.test(actor)) throw new Error('actor must use producer/version, human:<id>, or process:<id>');
  if (!datetimePattern.test(generatedAt) || Number.isNaN(Date.parse(generatedAt))) {
    throw new Error('generated_at must be an ISO 8601 datetime');
  }

  const concepts = (await markdownFiles(root)).filter(
    (filePath) => !['index.md', 'log.md'].includes(path.basename(filePath)),
  );
  let migrated = 0;
  for (const filePath of concepts) {
    const text = await readFile(filePath, 'utf8');
    const parsed = parseFrontmatter(filePath, text);
    let { frontmatter } = parsed;
    let body = parsed.body;
    const citationMatch = /(?:^|\r?\n)# Citations[ \t]*\r?\n+(.*)$/su.exec(body);
    const hasLegacyMetadata = Object.hasOwn(parsed.data, 'timestamp') || citationMatch !== null;

    if (Object.hasOwn(parsed.data, 'generated') && !hasLegacyMetadata) continue;
    if (Object.hasOwn(parsed.data, 'generated')) {
      throw new Error(`mixed v0.1 and v0.2 generation metadata: ${filePath}`);
    }
    if (Object.hasOwn(parsed.data, 'sources') && citationMatch !== null) {
      throw new Error(`cannot merge an existing sources field with legacy citations: ${filePath}`);
    }

    const sources = citationMatch === null ? [] : sourcesFrom(citationMatch[1]);
    if (citationMatch !== null && sources.length === 0 && citationMatch[1].trim().length > 0) {
      throw new Error(`legacy citation section contains no extractable resources: ${filePath}`);
    }
    if (citationMatch !== null) body = `${body.slice(0, citationMatch.index).trimEnd()}\n`;

    frontmatter = frontmatter
      .split(/(?<=\n)/u)
      .filter((line) => !/^timestamp:[ \t]*/u.test(line))
      .join('')
      .trimEnd();
    if (sources.length > 0) {
      frontmatter += '\nsources:\n';
      for (const source of sources) {
        frontmatter += `  - id: ${JSON.stringify(source.id)}\n`;
        frontmatter += `    resource: ${JSON.stringify(source.resource)}\n`;
        frontmatter += `    title: ${JSON.stringify(source.title)}\n`;
      }
    }
    frontmatter += `\ngenerated:\n  by: ${JSON.stringify(actor)}\n  at: ${JSON.stringify(generatedAt)}`;

    await writeFile(filePath, `---\n${frontmatter}\n---\n\n${body.trimStart()}`);
    migrated += 1;
  }

  const rootIndex = path.join(root, 'index.md');
  if (await isFile(rootIndex)) {
    const text = await readFile(rootIndex, 'utf8');
    if (text.startsWith('---')) {
      const parsed = parseFrontmatter(rootIndex, text);
      const keys = Object.keys(parsed.data);
      if (keys.length !== 1 || keys[0] !== 'okf_version') {
        throw new Error(`root index frontmatter may contain only okf_version: ${rootIndex}`);
      }
      await writeFile(rootIndex, `---\nokf_version: "0.2"\n---\n${parsed.body}`);
    } else {
      await writeFile(rootIndex, `---\nokf_version: "0.2"\n---\n\n${text}`);
    }
  }

  for (const filePath of (await markdownFiles(root)).filter((candidate) => path.basename(candidate) === 'log.md')) {
    let text = await readFile(filePath, 'utf8');
    if (/^# \d{4}-\d{2}-\d{2}[ \t]*$/u.test(text.split(/\r?\n/u)[0] ?? '')) {
      text = `# Knowledge Bundle Update Log\n\n${text}`;
    }
    text = text.replace(/^# (\d{4}-\d{2}-\d{2})[ \t]*$/gmu, '## $1');
    await writeFile(filePath, text);
  }

  return migrated;
}

function parseFrontmatter(filePath, text) {
  const match = /^---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n/su.exec(text);
  if (match === null) throw new Error(`missing frontmatter: ${filePath}`);
  let data;
  try {
    data = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) ?? {};
  } catch (error) {
    throw new Error(`invalid frontmatter in ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`frontmatter must be a mapping: ${filePath}`);
  }
  return { body: text.slice(match[0].length), data, frontmatter: match[1] };
}

function sourcesFrom(citations) {
  const links = [];
  const markdownLink = /\[([^\]]+)\]\(((?:[^()\s]+|\([^()]*\))+|<[^>]+>)\)/gu;
  const residual = citations.replace(markdownLink, (_match, rawTitle, rawResource) => {
    links.push([rawTitle.trim(), rawResource.replace(/^</u, '').replace(/>$/u, '')]);
    return '';
  });
  for (const match of residual.matchAll(/https?:\/\/[^\s<>)]+/gu)) links.push([match[0], match[0]]);

  const seen = new Set();
  const unique = [];
  for (const [title, resource] of links) {
    const key = `${title}\0${resource}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ id: `citation-${unique.length + 1}`, resource, title });
  }
  return unique;
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

if (isMainModule(import.meta.url)) {
  try {
    const root = process.argv[2];
    const actor = process.argv[3];
    if (root === undefined || actor === undefined) {
      throw new Error('usage: migrate-v01-to-v02.mjs <bundle-root> <actor> [generated-at]');
    }
    const migrated = await migrateV01ToV02(root, actor, process.argv[4]);
    process.stdout.write(`Migrated ${migrated} concepts in ${path.resolve(root)} to the OKF v0.2 producer profile.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function isMainModule(url) {
  return process.argv[1] !== undefined && url === pathToFileURL(path.resolve(process.argv[1])).href;
}
