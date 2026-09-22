import { appendFile, readFile } from 'node:fs/promises';

import { selectPackageLabsSuite } from './support/package-labs-suite.mts';

const eventName = requireEnvironment('GITHUB_EVENT_NAME');
const eventPath = requireEnvironment('GITHUB_EVENT_PATH');
const outputPath = requireEnvironment('GITHUB_OUTPUT');
const payload: unknown = JSON.parse(await readFile(eventPath, 'utf8'));
const labels = pullRequestLabels(payload);
const requestedSuite = workflowSuite(payload);
const suite = selectPackageLabsSuite({
  eventName,
  ...(process.env.GITHUB_REF === undefined ? {} : { ref: process.env.GITHUB_REF }),
  ...(labels === undefined ? {} : { labels }),
  ...(requestedSuite === undefined ? {} : { requestedSuite }),
});

await appendFile(outputPath, `suite=${suite}\n`);
process.stdout.write(`Selected Package Labs suite: ${suite}\n`);

function pullRequestLabels(eventPayload: unknown): readonly string[] | undefined {
  if (!isNonArrayObject(eventPayload) || !isNonArrayObject(eventPayload.pull_request)) return undefined;
  const eventLabels = eventPayload.pull_request.labels;
  if (!Array.isArray(eventLabels)) return undefined;
  return eventLabels.flatMap((label) =>
    isNonArrayObject(label) && typeof label.name === 'string' ? [label.name] : [],
  );
}

function workflowSuite(eventPayload: unknown): string | undefined {
  if (!isNonArrayObject(eventPayload) || !isNonArrayObject(eventPayload.inputs)) return undefined;
  return typeof eventPayload.inputs.suite === 'string' ? eventPayload.inputs.suite : undefined;
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}
