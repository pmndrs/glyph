import { readFile } from 'node:fs/promises';

import { formatCompactSizeLimitMarkdown, type SizeLimitRow } from './package-size-summary.ts';

const heading = '## size-limit report 📦 ';
const trace = process.env.SIZE_REPORT_TRACE_PATH;
if (trace === undefined) throw new Error('SIZE_REPORT_TRACE_PATH is required');

const records = (await readFile(trace, 'utf8'))
  .split('\n')
  .filter((line) => line.length > 0)
  .map((line) => JSON.parse(line) as SizeLimitRow[]);

// The pinned action measures the checked-out PR first and its base second. If it failed
// before completing both measurements, retain its original failure/comment as the evidence.
if (records.length !== 2) {
  console.warn(`Compact package-size report needs two measurements; received ${records.length}`);
  process.exit(0);
}

const current = records[0];
const base = records[1];
if (current === undefined || base === undefined) {
  throw new Error('Compact package-size report lost a completed measurement');
}
const body = `${heading}\n${formatCompactSizeLimitMarkdown(base, current)}`;
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
if (!response.ok) throw new Error(`GitHub package-size comment failed: ${response.status} ${await response.text()}`);

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
