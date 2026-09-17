import { appendFile, readFile } from 'node:fs/promises';

import { parsePackageSizeReport } from './package-size-report.ts';
import { formatCompactSizeLimitMarkdown, sizeLimitRows } from './package-size-summary.ts';

const heading = '## size-limit report 📦 ';
const current = sizeLimitRows(await readReport('SIZE_REPORT_CURRENT_PATH'));
const base = sizeLimitRows(await readReport('SIZE_REPORT_BASE_PATH'), { allowMissing: true });
const body = `${heading}\n${formatCompactSizeLimitMarkdown(base, current)}`;
const stepSummary = process.env.GITHUB_STEP_SUMMARY;
if (stepSummary !== undefined) await appendFile(stepSummary, `${body}\n`);
const repository = requiredEnvironment('SIZE_REPORT_REPOSITORY');
const pullRequest = requiredEnvironment('SIZE_REPORT_PR');
const token = requiredEnvironment('GH_TOKEN');
const comments = await listComments(repository, pullRequest, token);
const existing = comments.find((comment) => comment.body.startsWith(heading));
const endpoint =
  existing === undefined
    ? `https://api.github.com/repos/${repository}/issues/${pullRequest}/comments`
    : `https://api.github.com/repos/${repository}/issues/comments/${existing.id}`;
const response = await fetch(endpoint, {
  method: existing === undefined ? 'POST' : 'PATCH',
  headers: githubHeaders(token),
  body: JSON.stringify({ body }),
});
if (!response.ok) {
  const responseBody = await response.text();
  if (response.status === 403 && responseBody.includes('Resource not accessible by integration')) {
    console.warn('GitHub withheld pull-request comment permission; package sizes remain in the job summary');
    process.exit(0);
  }
  throw new Error(`GitHub package-size comment failed: ${response.status} ${responseBody}`);
}

async function readReport(environmentName: string) {
  const path = requiredEnvironment(environmentName);
  return parsePackageSizeReport(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

interface Comment {
  readonly id: number;
  readonly body: string;
}

async function listComments(repoSlug: string, prNumber: string, authToken: string): Promise<Comment[]> {
  const collectedComments: Comment[] = [];
  for (let page = 1; ; page += 1) {
    const pageResponse = await fetch(
      `https://api.github.com/repos/${repoSlug}/issues/${prNumber}/comments?per_page=100&page=${page}`,
      { headers: githubHeaders(authToken) },
    );
    if (!pageResponse.ok) {
      throw new Error(`GitHub comment lookup failed: ${pageResponse.status} ${await pageResponse.text()}`);
    }
    const entries = (await pageResponse.json()) as Comment[];
    collectedComments.push(...entries);
    if (entries.length < 100) return collectedComments;
  }
}

function githubHeaders(authToken: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}
