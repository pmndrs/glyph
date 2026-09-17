import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { sizeLimitRows } from './package-size-summary.ts';
import { measureR3fHelloWorldProductionBundle } from './production-app-size.ts';
import { measurePeerExternalizedReactAdapter } from './react-adapter-size.ts';

let input = '';
for await (const chunk of process.stdin) input += String(chunk);
const report = JSON.parse(input) as { entries?: unknown[] };
if (!report.entries?.some((entry) => isNonArrayObject(entry) && entry.id === 'react-runtime-js')) {
  if (!Array.isArray(report.entries)) throw new Error('package-size report requires entries');
  report.entries.push(
    await measurePeerExternalizedReactAdapter(
      process.cwd(),
      fileURLToPath(new URL('./react-runtime.ts', import.meta.url)),
    ),
  );
}
if (!report.entries?.some((entry) => isNonArrayObject(entry) && entry.id === 'r3f-hello-world-production-js')) {
  if (!Array.isArray(report.entries)) throw new Error('package-size report requires entries');
  report.entries.push(await measureR3fHelloWorldProductionBundle());
}
const rows = sizeLimitRows(report);
const trace = process.env.SIZE_REPORT_TRACE_PATH;
if (trace !== undefined) await appendFile(trace, `${JSON.stringify(rows)}\n`);
process.stdout.write(JSON.stringify(rows));

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
