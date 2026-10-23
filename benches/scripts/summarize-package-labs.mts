/* @workflow {
  "name": "benchmark:labs-summary",
  "summary": "Rebuild a completed package Labs Markdown report from its preserved results without timing again.",
  "requirements": "One completed report directory containing manifest.json, baseline.json, candidate.json and comparison.txt. Pass the directory as the sole argument.",
  "writes": "summary.md in that report directory. Raw timing results and manifests stay unchanged."
} */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { labsRunMedianTimes, labsRunNames, readLabsResult, timingModeDifferences } from './support/labs-result.mts';
import { parseLabsComparison, renderLabsSummary, writeLabsSummary } from './support/labs-summary.mts';

const args = process.argv.slice(2);
if (args.length !== 1) throw new Error('Pass one completed package Labs report directory');
const directory = resolve(args[0]!);
const manifest = nonArrayObject(await readLabsResult(resolve(directory, 'manifest.json')));
if (typeof manifest.suite !== 'string') throw new TypeError('Labs manifest is missing its suite');
const [baseline, candidate, report] = await Promise.all([
  readLabsResult(resolve(directory, 'baseline.json')),
  readLabsResult(resolve(directory, 'candidate.json')),
  readFile(resolve(directory, 'comparison.txt'), 'utf8'),
]);
const summary = renderLabsSummary({
  suite: manifest.suite,
  baseline: artifactLabel(manifest.baseline),
  candidate: artifactLabel(manifest.candidate),
  comparison: parseLabsComparison(
    report,
    labsRunNames(candidate),
    timingModeDifferences(baseline, candidate).map(({ name }) => name),
    labsRunMedianTimes(candidate),
  ),
});
await writeLabsSummary(
  manifest.savedCandidate === undefined
    ? summary
    : `Candidate timings reuse the saved run recorded in manifest.json.\n\n${summary}`,
  directory,
  {},
);
console.log(`Labs summary: ${resolve(directory, 'summary.md')}`);

function artifactLabel(value: unknown): string {
  const artifact = nonArrayObject(value);
  if (typeof artifact.version !== 'string') throw new TypeError('Labs manifest artifact is missing its version');
  if (artifact.sha256 === undefined) return artifact.version;
  if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) {
    throw new TypeError('Labs manifest artifact has an invalid SHA-256');
  }
  return `${artifact.version} (${artifact.sha256.slice(0, 8)})`;
}

function nonArrayObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('Expected a Labs manifest object');
  return Object.fromEntries(Object.entries(value));
}
