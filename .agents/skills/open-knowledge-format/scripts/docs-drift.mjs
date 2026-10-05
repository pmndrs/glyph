#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { validateOkf } from './validate-okf.mjs';
import { excludedDirectories, workspacePackages } from './workspace-packages.mjs';

const execFileAsync = promisify(execFile);

/** Marks the single issue the drift workflow rewrites; never change it without migrating that issue. */
export const driftIssueMarker = '<!-- okf-docs-drift -->';
/** Marks the single pull-request comment the docs report rewrites. */
export const docsReportMarker = '<!-- okf-docs-report -->';

const checkCommand = '`mise exec -- pnpm scripts run docs:check`';
const logCommand = '`mise exec -- pnpm scripts run docs:new -- log <slug> <title>`';

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

/**
 * Packages whose source this pull request changes without touching their concept, measured from the
 * merge base so the answer depends only on the pull request's own commits.
 */
export async function measurePullRequestDocs(workspaceRoot, base) {
  const root = path.resolve(workspaceRoot);
  const mergeBase = (await git(root, ['merge-base', base, 'HEAD'])).trim();
  const concepts = await packageConcepts(path.resolve(root, '.agents/docs'));
  const review = [];
  for (const [workspacePackage, packageRoot] of await workspacePackages(root)) {
    const concept = concepts.get(workspacePackage);
    if (concept === undefined) continue;
    const conceptPath = relativePath(root, concept);
    const files = lines(
      await git(root, [
        'diff',
        '--name-only',
        mergeBase,
        'HEAD',
        '--',
        ...sourcePathspecs(relativePath(root, packageRoot)),
      ]),
    );
    if (files.length === 0) continue;
    const conceptChanged =
      lines(await git(root, ['diff', '--name-only', mergeBase, 'HEAD', '--', conceptPath])).length > 0;
    if (!conceptChanged) review.push({ workspacePackage, concept: conceptPath, files });
  }
  return review;
}

/** Validation findings with bundle-relative paths, ready to show a contributor. */
export async function docsFindings(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const result = await validateOkf(path.join(root, '.agents/docs'), { workspaceRoot: root });
  return [...result.conformance, ...result.profile].map((finding) => finding.replaceAll(`${root}${path.sep}`, ''));
}

/** Renders the advisory pull-request comment: what to review, what is invalid, and the command for each. */
export function renderDocsReport({ review, findings, base }) {
  const out = [docsReportMarker, '## Docs report 📚', ''];
  if (review.length === 0 && findings.length === 0) {
    out.push(
      `Nothing to do: every concept this pull request affects was updated, and the bundle validates against \`${base}\`.`,
    );
    return `${out.join('\n')}\n`;
  }
  out.push(
    'Advisory only — this never blocks merging. A maintainer may merge as is; anything left unresolved moves to the',
    '`docs-drift` issue for a later maintenance pull request.',
  );
  if (review.length > 0) {
    out.push(
      '',
      '### Concepts to review',
      '',
      'This pull request changes package source without touching its concept. Correct anything the concept now gets',
      'wrong; when it is still accurate, update its `generated.at` to record the review.',
      '',
      '| Package | Concept | Changed files |',
      '| --- | --- | ---: |',
      ...review.map((entry) => `| \`${entry.workspacePackage}\` | \`${entry.concept}\` | ${entry.files.length} |`),
    );
  }
  if (findings.length > 0) {
    out.push(
      '',
      '### Validation findings',
      '',
      `Run ${checkCommand} locally to reproduce. Record new log entries and decisions with`,
      `${logCommand} (or \`-- decision\`) instead of editing \`log.md\` or the frozen register.`,
      '',
      ...findings.slice(0, listedFileLimit).map((finding) => `- ${finding}`),
    );
    if (findings.length > listedFileLimit) out.push(`- …and ${findings.length - listedFileLimit} more`);
  }
  return `${out.join('\n')}\n`;
}

/** Renders the drift report as the body of the single tracking issue. */
export function renderDriftIssue(report, options = {}) {
  const drifted = report.filter((entry) => entry.commits.length > 0);
  const findings = options.findings ?? [];
  const head = options.head === undefined ? '' : ` at \`${options.head}\``;
  const out = [driftIssueMarker, ''];
  if (drifted.length === 0 && findings.length === 0) {
    out.push(
      `Every workspace package concept is current and the bundle validates${head}. This issue reopens when either changes.`,
    );
    return `${out.join('\n')}\n`;
  }
  out.push(
    `${drifted.length} of ${report.length} workspace package concepts trail their source${head}, and the bundle has ` +
      `${findings.length} validation ${findings.length === 1 ? 'finding' : 'findings'}. ` +
      'This issue is rewritten on every push to `main`; edit the docs, not this issue.',
  );
  if (findings.length > 0) {
    out.push('', '## Validation findings', '', `Reproduce with ${checkCommand}.`, '');
    out.push(...findings.slice(0, listedFileLimit).map((finding) => `- ${finding}`));
    if (findings.length > listedFileLimit) out.push(`- …and ${findings.length - listedFileLimit} more`);
  }
  if (drifted.length === 0) return `${out.join('\n')}\n`;
  out.push(
    '',
    '## Drifted concepts',
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
    `from the last commit that touched the concept. Add one log entry with ${logCommand}, run`,
    `${checkCommand}, and open one pull request for the whole issue.`,
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
  const option = (name) => {
    const index = flags.indexOf(name);
    if (index === -1) return undefined;
    const value = flags[index + 1];
    if (value === undefined) throw new Error(`${name} requires a value`);
    return value;
  };
  try {
    const markdownPath = option('--markdown');
    const base = option('--pr');
    const findings = await docsFindings(workspaceRoot);
    if (base !== undefined) {
      // Pull-request mode: report only what this pull request introduces, never fail.
      const review = await measurePullRequestDocs(workspaceRoot, base);
      const body = renderDocsReport({ review, findings, base });
      if (markdownPath !== undefined) await writeFile(markdownPath, body);
      process.stdout.write(body);
    } else {
      const report = await measureDocsDrift(workspaceRoot);
      const head = (await git(path.resolve(workspaceRoot), ['rev-parse', '--short', 'HEAD'])).trim();
      if (markdownPath !== undefined) await writeFile(markdownPath, renderDriftIssue(report, { head, findings }));
      for (const entry of report) {
        const count = entry.commits.length;
        const status = count === 0 ? 'current' : `${count} ${count === 1 ? 'commit' : 'commits'} since review`;
        process.stdout.write(`${entry.workspacePackage}\t${status}\t${entry.concept}\n`);
      }
      for (const finding of findings) process.stdout.write(`finding\t${finding}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
