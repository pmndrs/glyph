/* @workflow { "name": "docs:check", "summary": "Validate the Open Knowledge Format agent archive under .agents/docs, including one concept per workspace package.", "requirements": "The repository-pinned Node.js runtime.", "writes": "stdout" } */
/* @workflow { "name": "docs:drift", "args": ["--drift"], "summary": "Report which package concepts trail their source in git history and any validation findings; pass --markdown <file> to write the drift issue body, or --pr <base-ref> for the advisory pull-request report.", "requirements": "The repository-pinned Node.js runtime and full git history.", "writes": "stdout and the optional --markdown file" } */
/* @workflow { "name": "docs:new", "args": ["--records", "new"], "summary": "Scaffold one append-only record: `-- log <slug> <title>` for a log entry or `-- decision <slug> <title>` for a decision file.", "requirements": "The repository-pinned Node.js runtime.", "writes": "One new file under .agents/docs/log/ or .agents/docs/planning/decisions/" } */
/* @workflow { "name": "docs:list", "args": ["--records", "list"], "summary": "List records newest first, 20 by default: `-- log [--since YYYY-MM-DD] [--mentions <text>] [--limit n | --all]` or `-- decision`.", "requirements": "The repository-pinned Node.js runtime.", "writes": "stdout" } */
/* @workflow { "name": "docs:search", "args": ["--query", "search"], "summary": "Find docs without reading whole files: `-- <terms…>` prints each matching paragraph under `path › Heading › Sub  [start-end]`; read that range next.", "requirements": "The repository-pinned Node.js runtime.", "writes": "stdout" } */
/* @workflow { "name": "docs:outline", "args": ["--query", "outline"], "summary": "Heading tree with [start-end] line ranges: `-- <path>` for a file or directory, `-- <path>:<line>` for the sections containing that line.", "requirements": "The repository-pinned Node.js runtime.", "writes": "stdout" } */
/* @workflow { "name": "docs:decision", "args": ["--query", "decision"], "summary": "Print one decision without loading the register: `-- D-123` or `-- <decision-slug>`.", "requirements": "The repository-pinned Node.js runtime.", "writes": "stdout" } */
import { isMainModule, run } from './support/command-cli.mts';

const skillScripts = '../.agents/skills/open-knowledge-format/scripts';
const validator = `${skillScripts}/validate-okf.mjs`;
const drift = `${skillScripts}/docs-drift.mjs`;
const records = `${skillScripts}/records.mjs`;
const query = `${skillScripts}/docs-query.mjs`;

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

/** Outlines, searches, or prints one decision, conserving the reader's context. */
export async function runDocsQuery(arguments_: readonly string[]): Promise<void> {
  await run(process.execPath, [query, '../.agents/docs', ...arguments_]);
}

if (isMainModule(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2);
  const task =
    mode === '--drift'
      ? runDocsDrift(rest)
      : mode === '--records'
        ? runDocsRecords(rest)
        : mode === '--query'
          ? runDocsQuery(rest)
          : runKnowledgeBaseCheck();
  task.catch((error: unknown) => {
    process.exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  });
}
