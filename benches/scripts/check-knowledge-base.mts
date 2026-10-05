/* @workflow { "name": "docs:check", "summary": "Validate the Open Knowledge Format agent archive under .agents/docs, including one concept per workspace package.", "requirements": "The repository-pinned Node.js runtime.", "writes": "stdout" } */
/* @workflow { "name": "docs:drift", "args": ["--drift"], "summary": "Report which package concepts trail their source in git history and any validation findings; pass --markdown <file> to write the drift issue body, or --pr <base-ref> for the advisory pull-request report.", "requirements": "The repository-pinned Node.js runtime and full git history.", "writes": "stdout and the optional --markdown file" } */
/* @workflow { "name": "docs:new", "args": ["--records", "new"], "summary": "Scaffold one append-only record: `-- log <slug> <title>` for a log entry or `-- decision <slug> <title>` for a decision file.", "requirements": "The repository-pinned Node.js runtime.", "writes": "One new file under .agents/docs/log/ or .agents/docs/planning/decisions/" } */
/* @workflow { "name": "docs:list", "args": ["--records", "list"], "summary": "List records newest first: `-- log` for the change log or `-- decision` for decision files.", "requirements": "The repository-pinned Node.js runtime.", "writes": "stdout" } */
import { isMainModule, run } from './support/command-cli.mts';

const skillScripts = '../.agents/skills/open-knowledge-format/scripts';
const validator = `${skillScripts}/validate-okf.mjs`;
const drift = `${skillScripts}/docs-drift.mjs`;
const records = `${skillScripts}/records.mjs`;

/** Validates the OKF bundle, including one Workspace Package concept per package. */
export async function runKnowledgeBaseCheck(): Promise<void> {
  await run(process.execPath, [validator, '../.agents/docs', '--workspace-root', '..']);
}

/**
 * Reports concept drift without failing: freshness is maintenance work tracked in one issue, not a
 * merge gate, so arguments after `--drift` pass straight to the reporter.
 */
export async function runDocsDrift(arguments_: readonly string[]): Promise<void> {
  await run(process.execPath, [drift, '..', ...arguments_]);
}

/** Creates or lists log entries and decision files; record rules live beside the validator. */
export async function runDocsRecords(arguments_: readonly string[]): Promise<void> {
  await run(process.execPath, [records, '../.agents/docs', ...arguments_]);
}

if (isMainModule(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2);
  const task =
    mode === '--drift' ? runDocsDrift(rest) : mode === '--records' ? runDocsRecords(rest) : runKnowledgeBaseCheck();
  task.catch((error: unknown) => {
    process.exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  });
}
