/* @workflow {
  "name": "docs:check",
  "summary": "Validate the Open Knowledge Format agent archive under .agents/docs, including every concept source_digest.",
  "requirements": "Ruby from the root mise toolchain. Run through mise so the interpreter resolves.",
  "writes": "stdout"
} */
/* @workflow {
  "name": "docs:update",
  "args": ["--write"],
  "summary": "Re-pin every package concept source_digest from the working tree, then validate the bundle.",
  "requirements": "Ruby from the root mise toolchain. Run through mise so the interpreter resolves.",
  "writes": ".agents/docs/packages/*.md source_digest pins and stdout"
} */
import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { isMainModule, run } from './support/command-cli.mts';

const execFileAsync = promisify(execFile);

const skillScripts = '../../.agents/skills/open-knowledge-format/scripts';
const validator = `${skillScripts}/validate_okf.rb`;
const generator = `${skillScripts}/generate_package_digests.rb`;

/**
 * Validate the repository knowledge bundle, optionally re-pinning it first.
 *
 * A package source or configuration change invalidates the matching concept's `source_digest`, and
 * a stale digest fails this gate. The commit hook that would otherwise re-pin silently no-ops when
 * Ruby is missing from the shell, so `--write` is the reliable way to apply what the gate demands
 * without hand-editing a hash.
 */
export async function runKnowledgeBaseCheck(options: { readonly write?: boolean } = {}): Promise<void> {
  if (options.write === true) await repinPackageDigests();
  await run('ruby', [validator, '../../.agents/docs', '--workspace-root', '../..']);
}

/**
 * Recompute every workspace package digest and rewrite the concept that pins it.
 *
 * The digest covers the package tree as it exists on disk, so this reflects the working tree rather
 * than the index. That is what a contributor wants when reacting to a failed gate; the commit hook
 * is the one that must hash staged content instead.
 */
async function repinPackageDigests(): Promise<void> {
  // Captured rather than streamed: the generator reports every workspace package, and echoing
  // that table would bury the one line a contributor needs, which is what actually changed.
  const { stdout: report } = await execFileAsync('ruby', [generator, '../..']);
  const concepts = await workspacePackageConcepts();
  let repinned = 0;
  for (const line of report.split('\n')) {
    const [workspacePackage, digest] = line.split('\t');
    if (workspacePackage === undefined || digest === undefined) continue;
    const concept = concepts.get(workspacePackage.trim());
    if (concept === undefined) continue;
    const before = await readConcept(concept);
    if (before === undefined) continue;
    const after = before.replace(/source_digest: 'sha256:[0-9a-f]{64}'/, `source_digest: '${digest}'`);
    if (after === before) continue;
    await writeFile(concept, after);
    process.stdout.write(`re-pinned ${concept.replace('../../', '')}\n`);
    repinned += 1;
  }
  if (repinned === 0) process.stdout.write('every concept digest was already current\n');
}

async function workspacePackageConcepts(): Promise<ReadonlyMap<string, string>> {
  const directory = '../../.agents/docs/packages';
  const concepts = new Map<string, string>();
  for (const entry of await readdir(directory)) {
    if (!entry.endsWith('.md')) continue;
    const path = `${directory}/${entry}`;
    const source = await readFile(path, 'utf8');
    const workspacePackage = /^workspace_package: ['"]([^'"]+)['"]$/m.exec(source)?.[1];
    if (workspacePackage !== undefined) concepts.set(workspacePackage, path);
  }
  return concepts;
}

async function readConcept(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    // A workspace package without a concept is not an error here: the validator owns the rule
    // about which packages must be documented, and reports it with its own message.
    return undefined;
  }
}

if (isMainModule(import.meta.url)) {
  runKnowledgeBaseCheck({ write: process.argv.includes('--write') }).catch((error: unknown) => {
    process.exitCode = 1;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  });
}
