#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { excludedDirectories, workspacePackages } from './workspace-packages.mjs';

const execFileAsync = promisify(execFile);

/** Marks the single issue the drift workflow rewrites; never change it without migrating that issue. */
export const driftIssueMarker = '<!-- okf-docs-drift -->';

const listedCommitLimit = 40;
const listedFileLimit = 60;

/**
 * Reports, per workspace package, the commits that changed package source after its concept was last
 * committed. The baseline is git history rather than a stored pin, so concurrent pull requests never
 * conflict over it; any commit that edits the concept is the review that clears its drift.
 */
export async function measureDocsDrift(workspaceRoot = '.', options = {}) {
  const root = path.resolve(workspaceRoot);
  const bundle = path.resolve(root, options.bundle ?? '.agents/docs');
  const concepts = await packageConcepts(bundle);
  const report = [];
  for (const [workspacePackage, packageRoot] of await workspacePackages(root)) {
    const concept = concepts.get(workspacePackage);
    // A package without a concept is the validator's error to report, not drift.
    if (concept === undefined) continue;
    const conceptPath = relativePath(root, concept);
    const sourcePath = relativePath(root, packageRoot);
    const baseline = await lastCommit(root, conceptPath);
    const pathspecs = sourcePathspecs(sourcePath);
    const range = baseline === undefined ? ['HEAD'] : [`${baseline.sha}..HEAD`];
    const commits = parseCommits(
      await git(root, ['log', '--no-merges', '--format=%h%x09%cs%x09%s', ...range, '--', ...pathspecs]),
    );
    const files =
      commits.length === 0 || baseline === undefined
        ? []
        : lines(await git(root, ['diff', '--name-only', baseline.sha, 'HEAD', '--', ...pathspecs]));
    report.push({ workspacePackage, concept: conceptPath, source: sourcePath, baseline, commits, files });
  }
  return report;
}

/** Renders the drift report as the body of the single tracking issue. */
export function renderDriftIssue(report, options = {}) {
  const drifted = report.filter((entry) => entry.commits.length > 0);
  const head = options.head === undefined ? '' : ` at \`${options.head}\``;
  const out = [driftIssueMarker, ''];
  if (drifted.length === 0) {
    out.push(`Every workspace package concept is current${head}. This issue reopens when source drifts again.`);
    return `${out.join('\n')}\n`;
  }
  out.push(
    `${drifted.length} of ${report.length} workspace package concepts trail their source${head}. ` +
      'This issue is rewritten on every push to `main`; edit the concepts, not this issue.',
    '',
    '| Package | Concept | Commits since review | Changed files |',
    '| --- | --- | ---: | ---: |',
  );
  for (const entry of drifted) {
    out.push(
      `| \`${entry.workspacePackage}\` | \`${entry.concept}\` | ${entry.commits.length} | ${entry.files.length} |`,
    );
  }
  out.push(
    '',
    '## Resolve',
    '',
    'For each package below, read the listed changes against its concept and correct anything the concept now',
    'gets wrong: ownership, boundaries, public surface, evidence, sources. When the concept is already right, record',
    'the review by updating its `generated.at` timestamp. Either edit clears that package, because drift is measured',
    'from the last commit that touched the concept. Add a `.agents/docs/log.md` entry, run',
    '`mise exec -- pnpm scripts run docs:check`, and open one pull request for the whole issue.',
  );
  for (const entry of drifted) {
    const since =
      entry.baseline === undefined ? 'never committed' : `\`${entry.baseline.sha}\` (${entry.baseline.date})`;
    out.push('', `### \`${entry.workspacePackage}\``, '', `Concept \`${entry.concept}\`, last reviewed ${since}.`, '');
    out.push(
      ...entry.commits
        .slice(0, listedCommitLimit)
        .map((commit) => `- \`${commit.sha}\` ${commit.date} ${commit.subject}`),
    );
    if (entry.commits.length > listedCommitLimit) out.push(`- …and ${entry.commits.length - listedCommitLimit} more`);
    if (entry.files.length > 0) {
      out.push('', '<details><summary>Changed files</summary>', '');
      out.push(...entry.files.slice(0, listedFileLimit).map((file) => `- \`${file}\``));
      if (entry.files.length > listedFileLimit) out.push(`- …and ${entry.files.length - listedFileLimit} more`);
      out.push('', '</details>');
    }
  }
  return `${out.join('\n')}\n`;
}

async function packageConcepts(bundle) {
  const concepts = new Map();
  for (const file of await markdownFiles(bundle)) {
    const text = await readFile(file, 'utf8');
    const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(text)?.[1];
    const workspacePackage = frontmatter && /^workspace_package:\s*['"]?([^'"\n]+?)['"]?\s*$/mu.exec(frontmatter)?.[1];
    if (workspacePackage !== undefined && workspacePackage !== '') concepts.set(workspacePackage, file);
  }
  return concepts;
}

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(absolutePath)));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(absolutePath);
  }
  return files.sort();
}

async function lastCommit(root, file) {
  const [sha, date] = (await git(root, ['log', '-1', '--format=%h%x09%cs', '--', file])).trim().split('\t');
  return sha === undefined || sha === '' ? undefined : { sha, date };
}

/** Package source as git pathspecs, with the same build and dependency output excluded everywhere. */
function sourcePathspecs(sourcePath) {
  return [
    sourcePath,
    ...excludedDirectories.flatMap((directory) => [
      `:(glob,exclude)${sourcePath}/${directory}/**`,
      `:(glob,exclude)${sourcePath}/**/${directory}/**`,
    ]),
  ];
}

function parseCommits(output) {
  return lines(output).map((line) => {
    const [sha, date, ...subject] = line.split('\t');
    return { sha, date, subject: subject.join('\t') };
  });
}

function lines(output) {
  return output.split('\n').filter(Boolean);
}

function relativePath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

async function git(cwd, arguments_) {
  const { stdout } = await execFileAsync('git', arguments_, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

function isMainModule(url) {
  return process.argv[1] !== undefined && url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isMainModule(import.meta.url)) {
  const [workspaceRoot = '.', ...flags] = process.argv.slice(2);
  const markdownIndex = flags.indexOf('--markdown');
  const markdownPath = markdownIndex === -1 ? undefined : flags[markdownIndex + 1];
  try {
    if (markdownIndex !== -1 && markdownPath === undefined) throw new Error('--markdown requires an output path');
    const report = await measureDocsDrift(workspaceRoot);
    const head = (await git(path.resolve(workspaceRoot), ['rev-parse', '--short', 'HEAD'])).trim();
    if (markdownPath !== undefined) await writeFile(markdownPath, renderDriftIssue(report, { head }));
    for (const entry of report) {
      const count = entry.commits.length;
      const status = count === 0 ? 'current' : `${count} ${count === 1 ? 'commit' : 'commits'} since review`;
      process.stdout.write(`${entry.workspacePackage}\t${status}\t${entry.concept}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
