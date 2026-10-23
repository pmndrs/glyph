/* @workflow {
  "name": "benchmark:cpu-profile-summary",
  "summary": "Summarize a saved Node or Chrome V8 CPU profile by self and inclusive sampled time.",
  "requirements": "A saved V8 CPU profile JSON. Optional --manifest may contain artifact-only proof for --artifact <tgz> source maps, or a named-Wasm proof that is authenticated whenever present. --wasm-url <exact profile URL> requires a named-Wasm proof. Artifact source maps require matching manifest.artifact.sha256. Optional --ancestry <json-file> contains disjoint {label,nodeId} phase anchors from this capture.",
  "writes": "The Markdown report at --output."
} */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { renderCpuProfileSummary, summarizeCpuProfile } from './support/cpu-profile-summary.mts';

const options = parseOptions(process.argv.slice(2));
const summary = await summarizeCpuProfile(
  options.profile,
  options.manifest,
  options.wasmUrl,
  options.artifact,
  options.ancestry,
);
const reportPath = resolve(process.cwd(), options.output);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, renderCpuProfileSummary(summary));
process.stdout.write(`CPU profile summary: ${reportPath}\n`);

function parseOptions(args: readonly string[]): {
  readonly profile: string;
  readonly output: string;
  readonly manifest?: string;
  readonly wasmUrl?: string;
  readonly artifact?: string;
  readonly ancestry?: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (
      name === undefined ||
      !['--profile', '--output', '--manifest', '--wasm-url', '--artifact', '--ancestry'].includes(name) ||
      value === undefined
    ) {
      throw new Error(
        'Usage: --profile <file> --output <markdown> [--manifest <file> --wasm-url <exact profile URL>] [--artifact <tgz>] [--ancestry <json-file>]',
      );
    }
    if (values.has(name)) throw new Error(`Duplicate option: ${name}`);
    values.set(name, value);
  }
  const profile = values.get('--profile');
  const output = values.get('--output');
  if (profile === undefined || output === undefined) throw new Error('--profile and --output are required');
  if (values.has('--wasm-url') && !values.has('--manifest')) throw new Error('--wasm-url requires --manifest');
  if (values.has('--artifact') && !values.has('--manifest')) throw new Error('--artifact requires --manifest');
  return {
    profile,
    output,
    ...(values.has('--manifest') ? { manifest: values.get('--manifest')! } : {}),
    ...(values.has('--wasm-url') ? { wasmUrl: values.get('--wasm-url')! } : {}),
    ...(values.has('--artifact') ? { artifact: values.get('--artifact')! } : {}),
    ...(values.has('--ancestry') ? { ancestry: values.get('--ancestry')! } : {}),
  };
}
