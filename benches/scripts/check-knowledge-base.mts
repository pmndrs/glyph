/* @workflow { "name": "docs:check", "summary": "Validate the Open Knowledge Format agent archive under .agents/docs, including one concept per workspace package.", "requirements": "The repository-pinned Node.js runtime.", "writes": "stdout" } */
/* @workflow { "name": "docs:drift", "args": ["--drift"], "summary": "Report which package concepts trail their source in git history; pass --markdown <file> to write the drift issue body.", "requirements": "The repository-pinned Node.js runtime and full git history.", "writes": "stdout and the optional --markdown file" } */
import { isMainModule, run } from './support/command-cli.mts';

const skillScripts = '../.agents/skills/open-knowledge-format/scripts';
const validator = `${skillScripts}/validate-okf.mjs`;
const drift = `${skillScripts}/docs-drift.mjs`;

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

if (isMainModule(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2);
  (mode === '--drift' ? runDocsDrift(rest) : runKnowledgeBaseCheck()).catch((error: unknown) => {
    process.exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  });
}
