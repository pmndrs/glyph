/* @workflow {
  "name": "docs:check",
  "summary": "Validate the Open Knowledge Format bundle under docs, including every concept source_digest.",
  "requirements": "Ruby from the root mise toolchain. Run through mise so the interpreter resolves.",
  "writes": "stdout"
} */
import { isMainModule, run } from './support/command-cli.mts';

const validator = '../../.agents/skills/open-knowledge-format/scripts/validate_okf.rb';

/**
 * Validate the repository knowledge bundle.
 *
 * A package source or configuration change invalidates the matching concept's `source_digest`, and
 * a stale digest fails this gate. The repository hook that would otherwise catch it silently
 * no-ops when Ruby is missing from the shell, so this workflow is the reliable way to reproduce
 * what CI enforces.
 */
export async function runKnowledgeBaseCheck(): Promise<void> {
  await run('ruby', [validator, '../../docs', '--workspace-root', '../..']);
}

if (isMainModule(import.meta.url)) {
  runKnowledgeBaseCheck().catch((error: unknown) => {
    process.exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  });
}
